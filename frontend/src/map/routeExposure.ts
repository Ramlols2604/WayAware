import type { ExposureCategoryCount, ExposureState, RouteExposureResult, RouteSafety } from '../types/api'

export const ZERO_SEGMENT_MESSAGE =
  'No matching reports in the included categories and date window.'

export const SEGMENT_DISTANCE_LABEL = 'Within 50 m of this route section.'

export const SEGMENT_EXPLANATION =
  'Historical reports across seven included categories, not a prediction or safety guarantee.'

export const COLOR_EXPLANATION =
  'Blue is lower historical exposure, yellow is moderate, and red is higher. Gray means the assessment is loading or unavailable. Blue is not a guarantee of safety. Colors use every matching historical report in the seven included categories within 50 m of the route. They are not a prediction.'

export const ROUTE_SUMMARY_LABEL = 'Most Encountered on Route'

export const ROUTE_SUMMARY_CONTEXT = 'Most reported historically within 50 m of this route.'

export const NO_ROUTE_SUMMARY_MATCH =
  'No matching categories from the route summary in this section.'

export const NO_ALTERNATIVE_MESSAGE = 'No alternative route was returned.'

export const NO_LOWER_EXPOSURE_MESSAGE =
  'No lower-exposure alternative found within the travel-time limit.'

export const COMPARISON_UNAVAILABLE_MESSAGE = 'Route comparison is unavailable.'

export function distinctCandidateCount(coordinates: unknown[]) {
  return new Set(coordinates.map((item) => JSON.stringify(item))).size
}

/** Notice for the latest trip. A single candidate is quiet until the user asks to reroute. */
export function tripNotice(input: {
  routeStatus: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  distinctCandidates: number
  comparisonStatus: 'idle' | 'loading' | 'ready' | 'error'
  rerouteNotice: string | null
}) {
  if (input.routeStatus !== 'ready') return null
  if (input.distinctCandidates >= 2 && input.comparisonStatus === 'error') {
    return COMPARISON_UNAVAILABLE_MESSAGE
  }
  if (input.rerouteNotice === NO_ALTERNATIVE_MESSAGE) {
    return input.distinctCandidates < 2 ? NO_ALTERNATIVE_MESSAGE : null
  }
  if (input.rerouteNotice === NO_LOWER_EXPOSURE_MESSAGE && input.distinctCandidates >= 2) {
    return NO_LOWER_EXPOSURE_MESSAGE
  }
  if (input.rerouteNotice === COMPARISON_UNAVAILABLE_MESSAGE) return COMPARISON_UNAVAILABLE_MESSAGE
  return null
}

const DETOUR_FRACTION = 0.5
const DETOUR_CAP_SECONDS = 10 * 60

export type ChoiceRoute = {
  id: string
  durationSeconds: number | null
}

export const ROUTE_PREFERENCE_STORAGE_KEY = 'wayaware.routePreference'

export function readStoredRoutePreference(stored: string | null): 'safest' | 'fastest' {
  if (stored === 'safest' || stored === 'fastest') return stored
  return 'safest'
}

export function writeStoredRoutePreference(storage: Pick<Storage, 'setItem'>, value: 'safest' | 'fastest') {
  storage.setItem(ROUTE_PREFERENCE_STORAGE_KEY, value)
}

export function detourAllowanceSeconds(fastestSeconds: number) {
  return Math.min(fastestSeconds * DETOUR_FRACTION, DETOUR_CAP_SECONDS)
}

function routeDuration(route: ChoiceRoute) {
  return route.durationSeconds ?? Number.POSITIVE_INFINITY
}

export function fastestRouteId(routes: ChoiceRoute[]) {
  if (!routes.length) return null
  return [...routes].sort((left, right) => routeDuration(left) - routeDuration(right) || left.id.localeCompare(right.id))[0].id
}

function eligibleWeights(
  routes: ChoiceRoute[],
  weights: Array<number | null>,
) {
  const fastest = Math.min(...routes.map(routeDuration))
  const allowance = detourAllowanceSeconds(fastest)
  return routes.flatMap((route, index) => {
    const weight = weights[index]
    if (weight === null || !Number.isFinite(weight)) return []
    if (routeDuration(route) > fastest + allowance) return []
    return [{ route, weight }]
  })
}

export function lowerExposureRouteId(routes: ChoiceRoute[], weights: Array<number | null> | null) {
  if (!routes.length || !weights || weights.length !== routes.length) return fastestRouteId(routes)
  const eligible = eligibleWeights(routes, weights)
  if (!eligible.length) return null
  eligible.sort((left, right) => left.weight - right.weight || routeDuration(left.route) - routeDuration(right.route))
  return eligible[0].route.id
}

export function rerouteId(routes: ChoiceRoute[], weights: Array<number | null> | null, currentId: string) {
  if (!weights || weights.length !== routes.length) return null
  const currentIndex = routes.findIndex((route) => route.id === currentId)
  const currentWeight = currentIndex < 0 ? null : weights[currentIndex]
  if (currentWeight === null || !Number.isFinite(currentWeight)) return null
  const eligible = eligibleWeights(routes, weights).filter(
    (item) => item.route.id !== currentId && item.weight < currentWeight,
  )
  if (!eligible.length) return null
  eligible.sort((left, right) => left.weight - right.weight || routeDuration(left.route) - routeDuration(right.route))
  return eligible[0].route.id
}

export function chooseDisplayedRoute(
  routes: ChoiceRoute[],
  routeKey: string,
  routePreference: RouteSafety,
  comparisonStatus: 'idle' | 'loading' | 'ready' | 'error',
  comparisonWeights: Array<number | null> | null,
  manualChoice: { key: string; id: string; preference: RouteSafety } | null,
) {
  if (!routes.length) return null
  if (
    manualChoice?.key === routeKey &&
    manualChoice.preference === routePreference &&
    routes.some((route) => route.id === manualChoice.id)
  ) {
    return manualChoice.id
  }
  if (routePreference === 'fastest' || comparisonStatus !== 'ready' || !comparisonWeights) {
    return fastestRouteId(routes)
  }
  return lowerExposureRouteId(routes, comparisonWeights) ?? fastestRouteId(routes)
}

/** Comparison weights describe the routes. A newer request is stale; Fastest/Safest is not. */
export function comparisonIsCurrent(requestId: number, activeRequestId: number) {
  return requestId === activeRequestId
}

const ROUTE_SUMMARY_LIMIT = 5
const SEGMENT_CATEGORY_LIMIT = 3

export const idleExposure: ExposureState = {
  requestId: 0,
  routeId: null,
  status: 'idle',
  segments: [],
  routeCategories: [],
  selectedId: null,
  appliedWindow: null,
  coverage: null,
}

function byCountThenCode(left: ExposureCategoryCount, right: ExposureCategoryCount) {
  return right.count - left.count || left.kyCd - right.kyCd
}

function positiveCategories(categories: ExposureCategoryCount[]) {
  return categories.filter((category) => category.count > 0).sort(byCountThenCode)
}

export function displayRouteCategories(categories: ExposureCategoryCount[]) {
  return positiveCategories(categories)
    .slice(0, ROUTE_SUMMARY_LIMIT)
    .sort((left, right) => left.offense.localeCompare(right.offense))
}

export function displaySegmentCategories(
  segmentCategories: ExposureCategoryCount[],
  routeCategories: ExposureCategoryCount[],
) {
  const routeNames = new Map(
    positiveCategories(routeCategories)
      .slice(0, ROUTE_SUMMARY_LIMIT)
      .map((category) => [category.kyCd, category.offense]),
  )
  return positiveCategories(segmentCategories)
    .filter((category) => routeNames.has(category.kyCd))
    .slice(0, SEGMENT_CATEGORY_LIMIT)
    .map((category) => ({
      kyCd: category.kyCd,
      offense: routeNames.get(category.kyCd) ?? category.offense,
      count: category.count,
    }))
    .sort((left, right) => left.offense.localeCompare(right.offense))
}

export function selectionForSegmentTap(level: string, segmentId: string) {
  if (level === 'moderate' || level === 'higher') return segmentId
  return null
}

export function beginExposureRequest(requestId: number, routeId: string): ExposureState {
  return {
    ...idleExposure,
    requestId,
    routeId,
    status: 'loading',
  }
}

export function exposureForRoute(state: ExposureState, routeId: string | null): ExposureState {
  if (routeId === null) {
    if (
      state.status === 'idle' &&
      state.segments.length === 0 &&
      state.routeCategories.length === 0 &&
      state.selectedId === null
    ) {
      return state
    }
    return { ...idleExposure, requestId: state.requestId }
  }
  if (state.routeId === routeId) return state
  return { ...idleExposure, requestId: state.requestId, status: 'loading' }
}

export function applyExposureResponse(
  state: ExposureState,
  requestId: number,
  response: RouteExposureResult,
): ExposureState {
  if (requestId !== state.requestId) return state
  if (response.segments.length === 0) return applyExposureError(state, requestId)
  return {
    requestId,
    routeId: state.routeId,
    status: 'ready',
    segments: response.segments,
    routeCategories: response.routeCategories,
    selectedId: null,
    appliedWindow: response.window,
    coverage: response.coverage,
  }
}

export function applyExposureError(state: ExposureState, requestId: number): ExposureState {
  if (requestId !== state.requestId) return state
  return {
    ...idleExposure,
    requestId,
    routeId: state.routeId,
    status: 'error',
  }
}

export function exposureLevelLabel(level: RouteExposureResult['segments'][number]['level']) {
  if (level === 'lower') return 'Lower exposure'
  if (level === 'moderate') return 'Moderate exposure'
  return 'Higher exposure'
}
