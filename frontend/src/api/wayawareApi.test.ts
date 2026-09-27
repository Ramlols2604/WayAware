import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `apiBaseUrl` is computed once from import.meta.env at module load, before
// any test runs, so vi.stubEnv can't reach it -- mock the module directly.
vi.mock('../env', () => ({ apiBaseUrl: 'http://backend.test', mapboxPublicToken: '' }))

const { requestAlongRoute, requestRouteExposure, retrievePlace, resetApiSpecCache, searchPlaces } = await import('./wayawareApi')
const { HISTORICAL_REPORT_WINDOW } = await import('../types/api')

const OPENAPI_STUB = { paths: {}, components: { schemas: {} } }

function jsonResponse(body: unknown, init?: { status?: number }) {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    json: async () => body,
  } as Response
}

describe('wayawareApi', () => {
  beforeEach(() => {
    resetApiSpecCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('retrievePlace parses the backend\'s { place, attribution } wrapper', async () => {
    // This is the actual shape GET /places/{mapbox_id} returns -- fields
    // nested one level under "place", not flat and not a GeoJSON Feature.
    // A prior version of the client only knew how to unwrap ".properties"
    // or a Feature/FeatureCollection, so it silently failed to find
    // coordinates here and every place selection errored out.
    const backendResponse = {
      place: {
        mapbox_id: 'abc123',
        name: 'Columbia University',
        full_address: '116th Street, New York City, New York 10027, United States',
        feature_type: 'poi',
        longitude: -73.9616288,
        latitude: 40.8078463,
      },
      attribution: '© 2026 Mapbox and its suppliers.',
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/openapi.json')) return jsonResponse(OPENAPI_STUB)
      return jsonResponse(backendResponse)
    })
    vi.stubGlobal('fetch', fetchMock)

    const place = await retrievePlace('abc123', '11111111-1111-4111-8111-111111111111')

    expect(place).toEqual({
      mapboxId: 'abc123',
      name: '116th Street, New York City, New York 10027, United States',
      longitude: -73.9616288,
      latitude: 40.8078463,
      attribution: '© 2026 Mapbox and its suppliers.',
    })
  })

  it('retrievePlace reuses the exact session token passed in on the request URL', async () => {
    const sessionToken = '22222222-2222-4222-8222-222222222222'
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url)
      if (url.endsWith('/openapi.json')) return jsonResponse(OPENAPI_STUB)
      return jsonResponse({
        place: { mapbox_id: 'xyz', name: 'Test Place', longitude: 1, latitude: 2 },
        attribution: '© Mapbox',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await retrievePlace('xyz', sessionToken)

    const retrieveCall = requestedUrls.find((url) => url.includes('/places/xyz'))
    expect(retrieveCall).toContain(`session_token=${sessionToken}`)
  })

  it('searchPlaces surfaces the attribution string on every suggestion', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/openapi.json')) return jsonResponse(OPENAPI_STUB)
      return jsonResponse({
        suggestions: [
          { mapbox_id: 'a', name: 'Place A', place_formatted: 'NYC' },
          { mapbox_id: 'b', name: 'Place B', place_formatted: 'NYC' },
        ],
        attribution: '© Mapbox search',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const suggestions = await searchPlaces('Place', '33333333-3333-4333-8333-333333333333')

    expect(suggestions).toHaveLength(2)
    expect(suggestions.every((s) => s.attribution === '© Mapbox search')).toBe(true)
    expect(suggestions[0]).toMatchObject({ label: 'Place A', subtitle: 'NYC' })
  })

  it('posts the full route line and reads capped historical reports', async () => {
    const geometry = {
      type: 'LineString' as const,
      coordinates: [
        [-73.985858, 40.748196],
        [-73.97, 40.77],
        [-73.961607, 40.807877],
      ] as [number, number][],
    }
    const posted: { url: string; init?: RequestInit } = { url: '' }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      posted.url = url
      posted.init = init
      return jsonResponse({
        window: { start: '2006-06-01T00:00:00Z', end: '2026-06-01T00:00:00Z' },
        radius_m: 50,
        limit: 100,
        returned: 100,
        truncated: true,
        coverage: {
          categories: [{ ky_cd: 109, ofns_desc: 'GRAND LARCENY' }],
          detail: 'Coverage includes only the seven selected NYPD complaint categories, not all crime and not live incidents.',
        },
        timestamp_quality: { time_of_day: 'unverified', detail: 'unverified until repair' },
        incidents: [
          {
            source: 'nypd_complaint',
            source_id: '326096311',
            ky_cd: 109,
            ofns_desc: 'GRAND LARCENY',
            pd_desc: 'LARCENY,GRAND FROM VEHICLE, UNATTENDED',
            law_cat_cd: 'FELONY',
            stored_occurred_at: '2026-05-15T14:30:00Z',
            time_of_day_known: false,
            distance_m: 18.4,
            latitude: 40.752,
            longitude: -73.981,
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestAlongRoute(geometry)

    const body = JSON.parse(String(posted.init?.body))
    expect(posted.url).toBe('http://backend.test/crime/along-route')
    expect(body.route).toEqual(geometry)
    expect(body.radius_m).toBe(50)
    expect(body.limit).toBe(100)
    expect(body.start).toBe(HISTORICAL_REPORT_WINDOW.start)
    expect(body.end).toBe(HISTORICAL_REPORT_WINDOW.end)
    expect(result.truncated).toBe(true)
    expect(result.returned).toBe(100)
    expect(result.window).toEqual({ start: HISTORICAL_REPORT_WINDOW.start, end: HISTORICAL_REPORT_WINDOW.end })
    expect(result.timestampQuality).toBe('unverified')
    expect(result.incidents[0]).toMatchObject({
      offense: 'GRAND LARCENY',
      timeOfDayKnown: false,
      distanceMeters: 18.4,
    })
  })

  it('requests a full-route exposure assessment without a marker limit', async () => {
    const geometry = {
      type: 'LineString' as const,
      coordinates: [
        [-73.98, 40.75],
        [-73.97, 40.76],
      ] as [number, number][],
    }
    let posted: { url?: string; init?: RequestInit } = {}
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/openapi.json')) return jsonResponse(OPENAPI_STUB)
      posted = { url, init }
      return jsonResponse({
        assessment_status: 'assessed',
        window: HISTORICAL_REPORT_WINDOW,
        radius_m: 50,
        coverage: {
          detail: 'seven categories',
          categories: [{ ky_cd: 109, ofns_desc: 'GRAND LARCENY' }],
        },
        route_categories: [
          { ky_cd: 106, ofns_desc: 'FELONY ASSAULT', count: 8 },
          { ky_cd: 109, ofns_desc: 'GRAND LARCENY', count: 140 },
        ],
        segments: [
          {
            id: '0',
            geometry,
            length_m: 100,
            level: 'higher',
            total_count: 140,
            categories: [{ ky_cd: 109, ofns_desc: 'GRAND LARCENY', count: 140 }],
            score: 999,
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestRouteExposure(geometry)
    const body = JSON.parse(String(posted.init?.body))

    expect(posted.url).toBe('http://backend.test/crime/route-exposure')
    expect(body.route).toEqual(geometry)
    expect(body.radius_m).toBe(50)
    expect(body.limit).toBeUndefined()
    expect(result.assessmentStatus).toBe('assessed')
    expect(result.segments[0]).toMatchObject({
      id: '0',
      level: 'higher',
      totalCount: 140,
      categories: [{ kyCd: 109, offense: 'GRAND LARCENY', count: 140 }],
    })
    expect(result.segments[0]).not.toHaveProperty('score')
    expect(result.routeCategories).toEqual([
      { kyCd: 106, offense: 'FELONY ASSAULT', count: 8 },
      { kyCd: 109, offense: 'GRAND LARCENY', count: 140 },
    ])
  })

  it('lets an aborted historical-report request reject as an abort', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = requestAlongRoute(
      { type: 'LineString', coordinates: [[-73.98, 40.75], [-73.96, 40.8]] },
      controller.signal,
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('retrievePlace throws when coordinates are genuinely absent (not just wrapped)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/openapi.json')) return jsonResponse(OPENAPI_STUB)
      return jsonResponse({ place: { mapbox_id: 'no-coords', name: 'Nowhere' }, attribution: '' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(retrievePlace('no-coords', '44444444-4444-4444-8444-444444444444')).rejects.toThrow(
      'Selected place did not include coordinates.',
    )
  })
})
