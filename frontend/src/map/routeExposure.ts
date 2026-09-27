import type { ExposureCategoryCount, ExposureState, RouteExposureResult } from '../types/api'

export const ZERO_SEGMENT_MESSAGE =
  'No matching reports in the included categories and date window.'

export const SEGMENT_DISTANCE_LABEL = 'Within 50 m of this route section.'

export const SEGMENT_EXPLANATION =
  'Historical reports across seven included categories, not a prediction or safety guarantee.'

export const COLOR_EXPLANATION =
  'Blue is lower historical exposure, yellow is moderate, and red is higher. Gray means the assessment is loading or unavailable. Blue is not a guarantee of safety. Colors use every matching historical report in the seven included categories within 50 m of the route. They are not a prediction.'

export const ROUTE_SUMMARY_LABEL = 'Most encountered on your route'

export const ROUTE_SUMMARY_CONTEXT = 'Most reported historically within 50 m of this route.'

const ROUTE_SUMMARY_LIMIT = 5

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

export function displayRouteCategories(categories: ExposureCategoryCount[]) {
  return [...categories]
    .sort((left, right) => right.count - left.count || left.kyCd - right.kyCd)
    .slice(0, ROUTE_SUMMARY_LIMIT)
    .sort((left, right) => left.offense.localeCompare(right.offense))
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
