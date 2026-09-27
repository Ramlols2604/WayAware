import { describe, expect, it } from 'vitest'
import type { ExposureSegment, RouteExposureResult } from '../types/api'
import {
  applyExposureError,
  applyExposureResponse,
  beginExposureRequest,
  displayRouteCategories,
  exposureForRoute,
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
