import type { Map as MapLibreMap, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import type { ExposureLevel, LineStringGeometry } from '../types/api'

const SOURCE_ID = 'wayaware-route'
const LAYER_ID = 'wayaware-route-line'
const ALTERNATIVE_SOURCE_ID = 'wayaware-route-alternatives'
const ALTERNATIVE_LAYER_ID = 'wayaware-route-alternatives-line'
export const ROUTE_HIT_LAYER_ID = 'wayaware-route-hit'
export const ALTERNATIVE_HIT_LAYER_ID = 'wayaware-route-alternatives-hit'

const emptyRoute = { type: 'FeatureCollection' as const, features: [] }

const EXPOSURE_COLOR: Record<ExposureLevel | 'unavailable', string> = {
  lower: '#3B82F6',
  moderate: '#EAB308',
  higher: '#DC2626',
  unavailable: '#9CA3AF',
}

export type DrawnRouteSegment = {
  /** Empty when the line is only a gray placeholder. */
  segmentId: string
  level: ExposureLevel | 'unavailable'
  coordinates: [number, number][]
}

export type DrawnAlternative = {
  routeId: string
  coordinates: [number, number][]
}

/**
 * Draws the selected route, colored by assessed historical exposure.
 * Gray means the assessment is loading or unavailable. A wider faint hit
 * layer makes each piece easier to tap.
 */
export function setRouteSegments(map: MapLibreMap, segments: DrawnRouteSegment[] | null) {
  const data = segments?.length
    ? {
        type: 'FeatureCollection' as const,
        features: segments.map((segment) => ({
          type: 'Feature' as const,
          properties: { segmentId: segment.segmentId, level: segment.level },
          geometry: { type: 'LineString' as const, coordinates: segment.coordinates },
        })),
      }
    : emptyRoute
  const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  map.addSource(SOURCE_ID, { type: 'geojson', data })
  map.addLayer({
    id: LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': [
        'match',
        ['get', 'level'],
        'lower',
        EXPOSURE_COLOR.lower,
        'moderate',
        EXPOSURE_COLOR.moderate,
        'higher',
        EXPOSURE_COLOR.higher,
        EXPOSURE_COLOR.unavailable,
      ],
      'line-width': 5,
      'line-opacity': 0.95,
    },
  })
  map.addLayer({
    id: ROUTE_HIT_LAYER_ID,
    type: 'line',
    source: SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#000000',
      'line-width': 22,
      'line-opacity': 0.01,
    },
  })
}

export function alternativeCollection(routes: DrawnAlternative[]) {
  return {
    type: 'FeatureCollection' as const,
    features: routes.map((route) => ({
      type: 'Feature' as const,
      properties: { routeId: route.routeId },
      geometry: { type: 'LineString' as const, coordinates: route.coordinates },
    })),
  }
}

/** Draws unselected candidates under the colored route. Exposure colors stay on the selection. */
export function setAlternativeRoutes(map: MapLibreMap, routes: DrawnAlternative[] | null) {
  const data = routes?.length ? alternativeCollection(routes) : emptyRoute
  const source = map.getSource(ALTERNATIVE_SOURCE_ID) as GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  map.addSource(ALTERNATIVE_SOURCE_ID, { type: 'geojson', data })
  const before = map.getLayer(LAYER_ID) ? LAYER_ID : undefined
  map.addLayer(
    {
      id: ALTERNATIVE_LAYER_ID,
      type: 'line',
      source: ALTERNATIVE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#64748B', 'line-width': 4, 'line-opacity': 0.7 },
    },
    before,
  )
  map.addLayer(
    {
      id: ALTERNATIVE_HIT_LAYER_ID,
      type: 'line',
      source: ALTERNATIVE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-width': 22, 'line-opacity': 0.01 },
    },
    before,
  )
}

export function alternativeIdFromClick(event: MapLayerMouseEvent) {
  const routeId = event.features?.[0]?.properties?.routeId
  return typeof routeId === 'string' && routeId ? routeId : null
}

export function segmentHitFromClick(event: MapLayerMouseEvent) {
  const properties = event.features?.[0]?.properties
  const segmentId = properties?.segmentId
  if (typeof segmentId !== 'string' || !segmentId) return null
  const level = properties?.level
  return { segmentId, level: typeof level === 'string' ? level : '' }
}

export function boundsForPoints(points: [number, number][]) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [longitude, latitude] of points) {
    west = Math.min(west, longitude)
    south = Math.min(south, latitude)
    east = Math.max(east, longitude)
    north = Math.max(north, latitude)
  }
  if (!Number.isFinite(west)) return null
  return { west, south, east, north }
}

export function fitRoute(
  map: MapLibreMap,
  geometry: LineStringGeometry,
  endpoints: [number, number][],
  padding: { top: number; bottom: number; left: number; right: number },
  also: [number, number][] = [],
) {
  const bounds = boundsForPoints([...geometry.coordinates, ...endpoints, ...also])
  if (!bounds) return
  map.fitBounds(
    [
      [bounds.west, bounds.south],
      [bounds.east, bounds.north],
    ],
    { padding, duration: 700, maxZoom: 15 },
  )
}
