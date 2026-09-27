import { describe, expect, it } from 'vitest'
import type { ExposureSegment, RouteExposureResult } from '../types/api'
import {
  applyExposureError,
  applyExposureResponse,
  beginExposureRequest,
  COMPARISON_UNAVAILABLE_MESSAGE,
  NO_ALTERNATIVE_MESSAGE,
  NO_LOWER_EXPOSURE_MESSAGE,
  chooseDisplayedRoute,
  comparisonIsCurrent,
  distinctCandidateCount,
  tripNotice,
  detourAllowanceSeconds,
  displayRouteCategories,
  displaySegmentCategories,
  exposureForRoute,
  fastestRouteId,
  lowerExposureRouteId,
  readStoredRoutePreference,
  rerouteId,
  selectionForSegmentTap,
  writeStoredRoutePreference,
  ROUTE_PREFERENCE_STORAGE_KEY,
} from './routeExposure'

function segment(id: string): ExposureSegment {
  return {
    id,
    coordinates: [
      [-73.99, 40.75],
      [-73.98, 40.75],
    ],
    lengthMeters: 100,
    level: 'higher',
    totalCount: 12,
    categories: [{ kyCd: 109, offense: 'GRAND LARCENY', count: 12 }],
  }
}

function result(id: string): RouteExposureResult {
  return {
    assessmentStatus: 'assessed',
    window: { start: '2006-06-01T00:00:00Z', end: '2026-06-01T00:00:00Z' },
    radiusMeters: 50,
    coverage: { detail: 'seven categories', categories: [] },
    segments: [segment(id)],
    routeCategories: [{ kyCd: 109, offense: 'GRAND LARCENY', count: 12 }],
  }
}

describe('route exposure state', () => {
  it('drops the previous colors and the open summary when the route changes', () => {
    const open = applyExposureResponse(beginExposureRequest(1, 'route-a'), 1, result('0'))
    const showing = { ...open, selectedId: '0' }
    const next = exposureForRoute(showing, 'route-b')

    expect(next.status).toBe('loading')
    expect(next.segments).toEqual([])
    expect(next.routeCategories).toEqual([])
    expect(next.selectedId).toBeNull()
  })

  it('keeps the five highest counts and shows them alphabetically', () => {
    const shown = displayRouteCategories([
      { kyCd: 110, offense: 'GRAND LARCENY OF MOTOR VEHICLE', count: 1 },
      { kyCd: 104, offense: 'RAPE', count: 1 },
      { kyCd: 101, offense: 'MURDER & NON-NEGL. MANSLAUGHTER', count: 1 },
      { kyCd: 109, offense: 'GRAND LARCENY', count: 4 },
      { kyCd: 106, offense: 'FELONY ASSAULT', count: 4 },
      { kyCd: 105, offense: 'ROBBERY', count: 2 },
      { kyCd: 107, offense: 'BURGLARY', count: 2 },
    ])

    expect(shown.map((category) => category.offense)).toEqual([
      'BURGLARY',
      'FELONY ASSAULT',
      'GRAND LARCENY',
      'MURDER & NON-NEGL. MANSLAUGHTER',
      'ROBBERY',
    ])
  })

  it('keeps a section count only when that category is also on the route', () => {
    const route = [
      { kyCd: 107, offense: 'BURGLARY', count: 900 },
      { kyCd: 105, offense: 'ROBBERY', count: 800 },
      { kyCd: 106, offense: 'FELONY ASSAULT', count: 700 },
      { kyCd: 101, offense: 'MURDER & NON-NEGL. MANSLAUGHTER', count: 600 },
      { kyCd: 104, offense: 'RAPE', count: 500 },
      { kyCd: 109, offense: 'GRAND LARCENY', count: 1 },
      { kyCd: 110, offense: 'GRAND LARCENY OF MOTOR VEHICLE', count: 1 },
    ]
    const segment = [
      { kyCd: 109, offense: 'GRAND LARCENY', count: 100 },
      { kyCd: 110, offense: 'GRAND LARCENY OF MOTOR VEHICLE', count: 50 },
      { kyCd: 105, offense: 'ROBBERY', count: 10 },
      { kyCd: 106, offense: 'FELONY ASSAULT', count: 8 },
      { kyCd: 101, offense: 'MURDER & NON-NEGL. MANSLAUGHTER', count: 2 },
      { kyCd: 104, offense: 'RAPE', count: 1 },
    ]

    expect(displaySegmentCategories(segment, route)).toEqual([
      { kyCd: 106, offense: 'FELONY ASSAULT', count: 8 },
      { kyCd: 101, offense: 'MURDER & NON-NEGL. MANSLAUGHTER', count: 2 },
      { kyCd: 105, offense: 'ROBBERY', count: 10 },
    ])
  })

  it('does not copy a route category into a section that has none', () => {
    expect(
      displaySegmentCategories(
        [{ kyCd: 109, offense: 'GRAND LARCENY', count: 4 }],
        [
          { kyCd: 105, offense: 'ROBBERY', count: 9 },
          { kyCd: 106, offense: 'FELONY ASSAULT', count: 3 },
        ],
      ),
    ).toEqual([])
  })

  it('stores only a valid route preference', () => {
    expect(readStoredRoutePreference(null)).toBe('safest')
    expect(readStoredRoutePreference('fastest')).toBe('fastest')
    expect(readStoredRoutePreference('safest')).toBe('safest')
    expect(readStoredRoutePreference('shortest')).toBe('safest')
  })

  it('selects the fastest route and limits a detour', () => {
    const routes = [
      { id: 'slow', durationSeconds: 1800 },
      { id: 'fast', durationSeconds: 600 },
      { id: 'mid', durationSeconds: 900 },
    ]
    expect(fastestRouteId(routes)).toBe('fast')
    expect(detourAllowanceSeconds(600)).toBe(300)
    expect(detourAllowanceSeconds(1800)).toBe(600)
    expect(lowerExposureRouteId(routes, [1, 50, 5])).toBe('mid')
    expect(lowerExposureRouteId(routes, [1, 50, 80])).toBe('fast')
  })

  it('breaks an equal exposure tie toward the faster route', () => {
    const routes = [
      { id: 'slow', durationSeconds: 700 },
      { id: 'fast', durationSeconds: 600 },
    ]
    expect(lowerExposureRouteId(routes, [10, 10])).toBe('fast')
  })

  it('reroutes only to a different strictly lower eligible route', () => {
    const routes = [
      { id: 'current', durationSeconds: 600 },
      { id: 'quieter', durationSeconds: 800 },
      { id: 'too-long', durationSeconds: 1300 },
      { id: 'same', durationSeconds: 650 },
    ]
    expect(rerouteId(routes, [20, 5, 1, 20], 'current')).toBe('quieter')
    expect(rerouteId(routes, [5, 20, 1, 20], 'current')).toBeNull()
    expect(rerouteId(routes, [20, 20, 1, 20], 'current')).toBeNull()
    expect(rerouteId(routes, [null, 1, 1, 1], 'current')).toBeNull()
    expect(NO_LOWER_EXPOSURE_MESSAGE).toContain('travel-time limit')
    expect(NO_ALTERNATIVE_MESSAGE).toContain('No alternative')
    expect(COMPARISON_UNAVAILABLE_MESSAGE).toContain('unavailable')
  })

  it('keeps a manual reroute until the preference changes', () => {
    const routes = [
      { id: 'fast', durationSeconds: 600 },
      { id: 'quiet', durationSeconds: 800 },
    ]
    const key = 'same-trip'
    const safestChoice = { key, id: 'quiet', preference: 'safest' as const }
    const fastestChoice = { key, id: 'fast', preference: 'fastest' as const }

    const manualFast = { key, id: 'fast', preference: 'safest' as const }
    expect(chooseDisplayedRoute(routes, key, 'safest', 'ready', [20, 5], safestChoice)).toBe('quiet')
    expect(chooseDisplayedRoute(routes, key, 'safest', 'ready', [20, 5], manualFast)).toBe('fast')
    expect(chooseDisplayedRoute(routes, key, 'safest', 'error', null, manualFast)).toBe('fast')
    expect(chooseDisplayedRoute(routes, key, 'safest', 'loading', null, manualFast)).toBe('fast')
    expect(chooseDisplayedRoute(routes, key, 'fastest', 'ready', [20, 5], fastestChoice)).toBe('fast')
    expect(chooseDisplayedRoute(routes, key, 'fastest', 'ready', [1, 50], safestChoice)).toBe('fast')
    expect(chooseDisplayedRoute(routes, key, 'safest', 'ready', [20, 5], fastestChoice)).toBe('quiet')
    expect(chooseDisplayedRoute(routes, 'other-trip', 'safest', 'ready', [20, 5], manualFast)).toBe('quiet')
    expect(chooseDisplayedRoute(routes, key, 'safest', 'loading', null, null)).toBe('fast')
  })

  it('shows route notices only for the current trip outcome', () => {
    expect(distinctCandidateCount([[1], [1], [2]])).toBe(2)
    const ready = { routeStatus: 'ready' as const, comparisonStatus: 'ready' as const, rerouteNotice: null }
    expect(tripNotice({ ...ready, distinctCandidates: 2, comparisonStatus: 'error' })).toBe(COMPARISON_UNAVAILABLE_MESSAGE)
    expect(tripNotice({ ...ready, distinctCandidates: 2, rerouteNotice: NO_ALTERNATIVE_MESSAGE })).toBeNull()
    expect(tripNotice({ ...ready, distinctCandidates: 1 })).toBeNull()
    expect(tripNotice({ ...ready, distinctCandidates: 1, rerouteNotice: NO_ALTERNATIVE_MESSAGE })).toBe(NO_ALTERNATIVE_MESSAGE)
    expect(tripNotice({ ...ready, distinctCandidates: 2, rerouteNotice: NO_LOWER_EXPOSURE_MESSAGE })).toBe(NO_LOWER_EXPOSURE_MESSAGE)
    expect(tripNotice({ ...ready, routeStatus: 'loading', distinctCandidates: 1, rerouteNotice: NO_ALTERNATIVE_MESSAGE })).toBeNull()
    expect(tripNotice({ ...ready, routeStatus: 'error', distinctCandidates: 0 })).toBeNull()
    expect(tripNotice({ ...ready, distinctCandidates: 1, comparisonStatus: 'error' })).toBeNull()
  })

  it('stores the preference separately from a trip', () => {
    const writes: Array<[string, string]> = []
    writeStoredRoutePreference(
      { setItem: (key, value) => writes.push([key, value]) },
      'fastest',
    )
    expect(writes).toEqual([[ROUTE_PREFERENCE_STORAGE_KEY, 'fastest']])
  })

  it('ignores a stale comparison result and keeps the current one after a preference change', () => {
    expect(comparisonIsCurrent(2, 2)).toBe(true)
    expect(comparisonIsCurrent(1, 2)).toBe(false)
  })

  it('opens details for red and yellow sections only', () => {
    expect(selectionForSegmentTap('lower', '4')).toBeNull()
    expect(selectionForSegmentTap('moderate', '4')).toBe('4')
    expect(selectionForSegmentTap('higher', '9')).toBe('9')
    expect(selectionForSegmentTap('unavailable', '1')).toBeNull()
  })

  it('ignores a stale assessment', () => {
    const current = applyExposureResponse(beginExposureRequest(2, 'route-b'), 2, result('new'))
    const stale = applyExposureResponse(current, 1, result('old'))
    const staleError = applyExposureError(current, 1)

    expect(stale).toBe(current)
    expect(staleError).toBe(current)
    expect(current.segments.map((item) => item.id)).toEqual(['new'])
    expect(current.routeCategories).toEqual([{ kyCd: 109, offense: 'GRAND LARCENY', count: 12 }])
  })

  it('keeps an empty or failed assessment uncolored', () => {
    const loading = beginExposureRequest(1, 'route-a')
    const empty = applyExposureResponse(loading, 1, { ...result('0'), segments: [] })
    const failed = applyExposureError(beginExposureRequest(1, 'route-a'), 1)

    expect(empty.status).toBe('error')
    expect(empty.segments).toEqual([])
    expect(failed.status).toBe('error')
    expect(failed.segments).toEqual([])
    expect(failed.selectedId).toBeNull()
  })
})
