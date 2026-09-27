import { apiBaseUrl } from '../env'
import {
  HISTORICAL_REPORT_LIMIT,
  HISTORICAL_REPORT_RADIUS_M,
  HISTORICAL_REPORT_WINDOW,
  type HistoricalReport,
  type HistoricalReportResult,
  type ExposureCategoryCount,
  type ExposureLevel,
  type ExposureSegment,
  type LineStringGeometry,
  type RouteExposureResult,
  type PlaceSuggestion,
  type ResolvedPlace,
  type RouteAlternative,
  type RouteEndpoints,
  type RouteSafety,
  type TravelMode,
} from '../types/api'

export class WayAwareApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'WayAwareApiError'
    this.status = status
  }
}

type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  enum?: string[]
  $ref?: string
  items?: JsonSchema
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
}

type OpenApiDoc = {
  paths?: Record<string, { get?: Operation; post?: Operation }>
  components?: { schemas?: Record<string, JsonSchema> }
}

type Operation = {
  parameters?: { name?: string; in?: string; schema?: JsonSchema }[]
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> }
  responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }>
}

let specRequest: Promise<OpenApiDoc | null> | null = null

function loadSpec(): Promise<OpenApiDoc | null> {
  if (!apiBaseUrl) return Promise.resolve(null)
  if (!specRequest) {
    specRequest = fetch(`${apiBaseUrl}/openapi.json`)
      .then((response) => (response.ok ? (response.json() as Promise<OpenApiDoc>) : null))
      .catch(() => null)
  }
  return specRequest
}

export function resetApiSpecCache() {
  specRequest = null
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  if (!apiBaseUrl) {
    throw new WayAwareApiError('Backend URL is not configured.')
  }
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new WayAwareApiError('Network request failed.')
  }
  if (!response.ok) {
    throw new WayAwareApiError(`Request failed (${response.status}).`, response.status)
  }
  if (response.status === 204) return null
  return response.json()
}

export async function searchPlaces(query: string, sessionToken: string): Promise<PlaceSuggestion[]> {
  const spec = await loadSpec()
  const params = new URLSearchParams()
  const names = queryParamNames(spec, '/places/search', ['q', 'session_token'])
  params.set(names.query, query)
  params.set(names.session, sessionToken)
  const data = await requestJson(`/places/search?${params.toString()}`)
  return extractSuggestions(data)
}

export async function retrievePlace(mapboxId: string, sessionToken: string): Promise<ResolvedPlace> {
  const spec = await loadSpec()
  const names = queryParamNames(spec, '/places/{mapbox_id}', ['session_token'])
  const params = new URLSearchParams()
  params.set(names.session, sessionToken)
  const data = await requestJson(`/places/${encodeURIComponent(mapboxId)}?${params.toString()}`)
  const place = extractPlace(data, mapboxId)
  if (!place) throw new WayAwareApiError('Selected place did not include coordinates.')
  return place
}

export async function requestAlongRoute(
  geometry: LineStringGeometry,
  signal?: AbortSignal,
): Promise<HistoricalReportResult> {
  const data = await requestJson('/crime/along-route', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      route: geometry,
      radius_m: HISTORICAL_REPORT_RADIUS_M,
      start: HISTORICAL_REPORT_WINDOW.start,
      end: HISTORICAL_REPORT_WINDOW.end,
      limit: HISTORICAL_REPORT_LIMIT,
    }),
  })
  return parseAlongRoute(data)
}

export async function requestRouteExposure(
  geometry: LineStringGeometry,
  signal?: AbortSignal,
): Promise<RouteExposureResult> {
  const data = await requestJson('/crime/route-exposure', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      route: geometry,
      radius_m: HISTORICAL_REPORT_RADIUS_M,
      start: HISTORICAL_REPORT_WINDOW.start,
      end: HISTORICAL_REPORT_WINDOW.end,
    }),
  })
  return parseRouteExposure(data)
}

export async function requestRouteComparison(
  geometries: LineStringGeometry[],
  signal?: AbortSignal,
): Promise<number[]> {
  const data = await requestJson('/crime/route-comparison', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      routes: geometries,
      radius_m: HISTORICAL_REPORT_RADIUS_M,
      start: HISTORICAL_REPORT_WINDOW.start,
      end: HISTORICAL_REPORT_WINDOW.end,
    }),
  })
  if (!isRecord(data) || !Array.isArray(data.weights) || data.weights.length !== geometries.length) {
    throw new WayAwareApiError('Route comparison did not include a weight for every route.')
  }
  return data.weights.map((value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new WayAwareApiError('Route comparison did not include a weight for every route.')
    }
    return value
  })
}

export async function requestRoutes(endpoints: RouteEndpoints): Promise<RouteAlternative[]> {
  const spec = await loadSpec()
  const body = buildRouteBody(spec, endpoints)
  const data = await requestJson('/routes', { method: 'POST', body: JSON.stringify(body) })
  return extractRoutes(data)
}

function queryParamNames(spec: OpenApiDoc | null, path: string, fallback: string[]) {
  const params = spec?.paths?.[path]?.get?.parameters ?? []
  const queryNames = params.filter((param) => param.in === 'query' && param.name).map((param) => param.name as string)
  const query = queryNames.find((name) => name === 'q' || /query|search/i.test(name)) ?? fallback[0] ?? 'q'
  const session = queryNames.find((name) => /session/i.test(name)) ?? 'session_token'
  return { query, session }
}

function resolveSchema(spec: OpenApiDoc | null, schema: JsonSchema | undefined): JsonSchema | null {
  if (!schema) return null
  if (schema.$ref && spec?.components?.schemas) {
    const name = schema.$ref.split('/').pop() ?? ''
    return spec.components.schemas[name] ?? schema
  }
  const combined = schema.allOf ?? schema.anyOf
  if (combined?.length && spec) {
    return combined.map((item) => resolveSchema(spec, item)).find((item) => item?.properties || item?.enum) ?? schema
  }
  return schema
}

function buildRouteBody(spec: OpenApiDoc | null, endpoints: RouteEndpoints): Record<string, unknown> {
  const operation = spec?.paths?.['/routes']?.post
  const media = operation?.requestBody?.content?.['application/json']?.schema
  const schema = resolveSchema(spec, media)
  const properties = schema?.properties
  if (!properties) {
    return {
      origin: { longitude: endpoints.origin.longitude, latitude: endpoints.origin.latitude },
      destination: { longitude: endpoints.destination.longitude, latitude: endpoints.destination.latitude },
      mode: endpoints.mode,
    }
  }

  const body: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(properties)) {
    const property = resolveSchema(spec, raw)
    if (!property) continue
    if (property.enum?.length) {
      body[key] = matchTravelMode(property.enum, endpoints.mode)
      continue
    }
    if (/origin|start|from/i.test(key)) {
      body[key] = coordinateValue(property, endpoints.origin)
      continue
    }
    if (/destination|end|to/i.test(key) && !/duration|distance/i.test(key)) {
      body[key] = coordinateValue(property, endpoints.destination)
    }
  }
  if (!('origin' in body) && !Object.keys(body).some((key) => /origin|start/i.test(key))) {
    body.origin = { longitude: endpoints.origin.longitude, latitude: endpoints.origin.latitude }
    body.destination = { longitude: endpoints.destination.longitude, latitude: endpoints.destination.latitude }
    body.mode = endpoints.mode
  }
  return body
}

function matchTravelMode(values: string[], mode: TravelMode) {
  const wanted = mode === 'walking' ? /walk/i : /driv|car/i
  return values.find((value) => wanted.test(value)) ?? values[0]
}

function coordinateValue(schema: JsonSchema, point: { longitude: number; latitude: number }) {
  const properties = schema.properties
  if (!properties) return { longitude: point.longitude, latitude: point.latitude }
  const value: Record<string, number> = {}
  for (const key of Object.keys(properties)) {
    if (/lat/i.test(key)) value[key] = point.latitude
    else if (/lon|lng/i.test(key)) value[key] = point.longitude
  }
  return Object.keys(value).length ? value : { longitude: point.longitude, latitude: point.latitude }
}

function extractSuggestions(data: unknown): PlaceSuggestion[] {
  const rows = findObjectArray(data)
  const attribution = isRecord(data) ? (readString(data, [/^attribution$/i]) ?? '') : ''
  const suggestions: PlaceSuggestion[] = []
  for (const row of rows) {
    const mapboxId = readString(row, [/mapbox[_ ]?id/i, /^id$/i])
    if (!mapboxId) continue
    const label = readString(row, [/^name$/i, /place[_ ]?name/i, /^label$/i, /^text$/i, /full[_ ]?address/i]) ?? mapboxId
    const subtitle = readString(row, [/full[_ ]?address/i, /place[_ ]?formatted/i, /^address$/i, /description/i]) ?? ''
    suggestions.push({ mapboxId, label, subtitle: subtitle === label ? '' : subtitle, attribution })
  }
  return suggestions
}

// Our backend nests a resolved place's fields under a "place" key
// (`{ place: { mapbox_id, name, longitude, latitude, ... }, attribution }`),
// which isn't a GeoJSON Feature/FeatureCollection and has no "properties"
// wrapper, so the generic readers below wouldn't otherwise find it.
function unwrapPlace(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null
  return isRecord(data.place) ? data.place : null
}

function extractPlace(data: unknown, mapboxId: string): ResolvedPlace | null {
  const feature = findFeature(data)
  const wrapped = unwrapPlace(data)
  const source = feature ?? wrapped ?? (isRecord(data) ? data : null)
  if (!source) return null
  const coordinates = readCoordinates(source) ?? (feature ? readCoordinates(feature) : null)
  if (!coordinates) return null
  const name =
    readString(source, [/full[_ ]?address/i, /^name$/i, /place[_ ]?formatted/i, /place[_ ]?name/i]) ??
    (feature ? readString(feature, [/full[_ ]?address/i, /^name$/i]) : null) ??
    mapboxId
  const attribution = isRecord(data) ? (readString(data, [/^attribution$/i]) ?? '') : ''
  return {
    mapboxId: readString(source, [/mapbox[_ ]?id/i]) ?? mapboxId,
    name,
    longitude: coordinates[0],
    latitude: coordinates[1],
    attribution,
  }
}

function extractRoutes(data: unknown): RouteAlternative[] {
  const rows = findRouteRows(data)
  return rows
    .map((row, index) => {
      const geometry = readLineString(row)
      if (!geometry) return null
      return {
        id: readString(row, [/^id$/i, /route[_ ]?id/i]) ?? `route-${index + 1}`,
        durationSeconds: readDuration(row),
        distanceMeters: readDistance(row),
        geometry,
        safety: readSafety(row),
      }
    })
    .filter((route): route is RouteAlternative => route !== null)
}

function findRouteRows(data: unknown): Record<string, unknown>[] {
  if (!isRecord(data)) return []
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    return data.features.filter(isRecord)
  }
  for (const key of ['routes', 'alternatives', 'results']) {
    if (Array.isArray(data[key])) return data[key].filter(isRecord)
  }
  if (readLineString(data)) return [data]
  return []
}

function findFeature(data: unknown): Record<string, unknown> | null {
  if (!isRecord(data)) return null
  if (data.type === 'Feature') return data
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    return data.features.find(isRecord) ?? null
  }
  return null
}

function findObjectArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord)
  if (!isRecord(data)) return []
  for (const key of ['suggestions', 'results', 'features', 'places', 'candidates']) {
    if (Array.isArray(data[key])) return data[key].filter(isRecord)
  }
  const nested = Object.values(data).find((value) => Array.isArray(value) && value.some(isRecord))
  return Array.isArray(nested) ? nested.filter(isRecord) : []
}

function readLineString(row: Record<string, unknown>): LineStringGeometry | null {
  const candidates = [row.geometry, row.line, row.linestring, row.geojson, row]
  for (const candidate of candidates) {
    if (!isRecord(candidate) || candidate.type !== 'LineString' || !Array.isArray(candidate.coordinates)) continue
    const coordinates = candidate.coordinates.filter(isLngLat)
    if (coordinates.length >= 2) return { type: 'LineString', coordinates }
  }
  return null
}

function readCoordinates(row: Record<string, unknown>): [number, number] | null {
  const geometry = isRecord(row.geometry) ? row.geometry : null
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates) && isLngLat(geometry.coordinates)) {
    return geometry.coordinates
  }
  const properties = isRecord(row.properties) ? row.properties : row
  const nested = isRecord(properties.coordinates) ? properties.coordinates : properties
  const latitude = readNumber(nested, [/latitude/i, /^lat$/i])
  const longitude = readNumber(nested, [/longitude/i, /^lng$|^lon$/i])
  if (latitude === null || longitude === null) return null
  return [longitude, latitude]
}

function readDuration(row: Record<string, unknown>): number | null {
  const properties = isRecord(row.properties) ? row.properties : row
  const seconds = readNumber(properties, [/duration[_ ]?seconds/i, /^duration$/i, /^time$/i])
  if (seconds !== null) return seconds
  const minutes = readNumber(properties, [/duration[_ ]?min/i])
  return minutes === null ? null : minutes * 60
}

function readDistance(row: Record<string, unknown>): number | null {
  const properties = isRecord(row.properties) ? row.properties : row
  const meters = readNumber(properties, [/distance[_ ]?meters/i, /^distance$/i])
  if (meters !== null) return meters
  const miles = readNumber(properties, [/distance[_ ]?mi/i])
  return miles === null ? null : miles * 1609.344
}

function readSafety(row: Record<string, unknown>): RouteSafety | null {
  const properties = isRecord(row.properties) ? row.properties : row
  if (properties.safest === true) return 'safest'
  if (properties.fastest === true) return 'fastest'
  const raw = readString(properties, [/safety/i, /preference/i, /route[_ ]?type/i])
  if (!raw) return null
  if (/safe/i.test(raw)) return 'safest'
  if (/fast/i.test(raw)) return 'fastest'
  return null
}

function readString(row: Record<string, unknown>, patterns: RegExp[]) {
  const properties = isRecord(row.properties) ? row.properties : row
  for (const pattern of patterns) {
    const key = Object.keys(properties).find((name) => pattern.test(name))
    const value = key ? properties[key] : undefined
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function readNumber(row: Record<string, unknown>, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const key = Object.keys(row).find((name) => pattern.test(name))
    const value = key ? row[key] : undefined
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function isLngLat(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number'
}

function parseAlongRoute(data: unknown): HistoricalReportResult {
  if (!isRecord(data) || !Array.isArray(data.incidents) || !isRecord(data.window) || !isRecord(data.coverage)) {
    throw new WayAwareApiError('Historical reports were not returned.')
  }
  const start = readString(data.window, [/^start$/i])
  const end = readString(data.window, [/^end$/i])
  const detail = readString(data.coverage, [/^detail$/i])
  const returned = readNumber(data, [/^returned$/i])
  if (!start || !end || !detail || returned === null || typeof data.truncated !== 'boolean') {
    throw new WayAwareApiError('Historical reports were not returned.')
  }
  const categories = Array.isArray(data.coverage.categories) ? data.coverage.categories.filter(isRecord) : []
  const incidents = data.incidents.filter(isRecord).map(parseHistoricalReport)
  return {
    window: { start, end },
    returned,
    truncated: data.truncated,
    coverage: {
      detail,
      categories: categories.map((category) => ({
        kyCd: readNumber(category, [/ky_cd/i]) ?? 0,
        offense: readString(category, [/ofns_desc/i]) ?? 'Historical report',
      })),
    },
    timestampQuality: 'unverified',
    incidents,
  }
}

function parseRouteExposure(data: unknown): RouteExposureResult {
  if (!isRecord(data) || data.assessment_status !== 'assessed' || !Array.isArray(data.segments)) {
    throw new WayAwareApiError('Route exposure was not returned.')
  }
  if (!isRecord(data.window) || !isRecord(data.coverage)) {
    throw new WayAwareApiError('Route exposure was not returned.')
  }
  const start = readString(data.window, [/^start$/i])
  const end = readString(data.window, [/^end$/i])
  const detail = readString(data.coverage, [/^detail$/i])
  const radiusMeters = readNumber(data, [/^radius_m$/i])
  if (!start || !end || !detail || radiusMeters === null) {
    throw new WayAwareApiError('Route exposure was not returned.')
  }
  const categories = Array.isArray(data.coverage.categories) ? data.coverage.categories.filter(isRecord) : []
  return {
    assessmentStatus: 'assessed',
    window: { start, end },
    radiusMeters,
    coverage: {
      detail,
      categories: categories.map((category) => ({
        kyCd: readNumber(category, [/ky_cd/i]) ?? 0,
        offense: readString(category, [/ofns_desc/i]) ?? 'Historical report',
      })),
    },
    routeCategories: parseCategoryCounts(data.route_categories),
    segments: data.segments.filter(isRecord).map(parseExposureSegment),
  }
}

function parseCategoryCounts(value: unknown): ExposureCategoryCount[] {
  if (!Array.isArray(value)) throw new WayAwareApiError('Route exposure was not returned.')
  return value.filter(isRecord).map((category) => ({
    kyCd: readNumber(category, [/ky_cd/i]) ?? 0,
    offense: readString(category, [/ofns_desc/i]) ?? 'Historical report',
    count: readNumber(category, [/^count$/i]) ?? 0,
  }))
}

function parseExposureSegment(row: Record<string, unknown>): ExposureSegment {
  const id = readString(row, [/^id$/i])
  const geometry = isRecord(row.geometry) ? row.geometry : null
  const coordinates = geometry && Array.isArray(geometry.coordinates) ? geometry.coordinates.filter(isLngLat) : []
  const level = exposureLevel(row.level)
  const totalCount = readNumber(row, [/total_count/i])
  if (!id || coordinates.length < 2 || !level || totalCount === null) {
    throw new WayAwareApiError('Route exposure was not returned.')
  }
  const categories = Array.isArray(row.categories) ? row.categories.filter(isRecord) : []
  return {
    id,
    coordinates,
    lengthMeters: readNumber(row, [/length_m/i]) ?? 0,
    level,
    totalCount,
    categories: categories.map((category) => ({
      kyCd: readNumber(category, [/ky_cd/i]) ?? 0,
      offense: readString(category, [/ofns_desc/i]) ?? 'Historical report',
      count: readNumber(category, [/^count$/i]) ?? 0,
    })),
  }
}

function exposureLevel(value: unknown): ExposureLevel | null {
  if (value === 'lower' || value === 'moderate' || value === 'higher') return value
  return null
}

function parseHistoricalReport(row: Record<string, unknown>): HistoricalReport {
  const source = readString(row, [/^source$/i])
  const sourceId = readString(row, [/source_id/i])
  const storedOccurredAt = readString(row, [/stored_occurred_at/i])
  const latitude = readNumber(row, [/^latitude$/i])
  const longitude = readNumber(row, [/^longitude$/i])
  const distanceMeters = readNumber(row, [/distance_m/i])
  if (!source || !sourceId || !storedOccurredAt || latitude === null || longitude === null || distanceMeters === null) {
    throw new WayAwareApiError('Historical reports were not returned.')
  }
  return {
    id: `${source}:${sourceId}:${storedOccurredAt}`,
    offense: readString(row, [/ofns_desc/i]) ?? 'Historical report',
    description: readString(row, [/pd_desc/i]),
    storedOccurredAt,
    timeOfDayKnown: row.time_of_day_known === true,
    distanceMeters,
    latitude,
    longitude,
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
