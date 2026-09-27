import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `apiBaseUrl` is computed once from import.meta.env at module load, before
// any test runs, so vi.stubEnv can't reach it -- mock the module directly.
vi.mock('../env', () => ({ apiBaseUrl: 'http://backend.test', mapboxPublicToken: '' }))

const { retrievePlace, resetApiSpecCache, searchPlaces } = await import('./wayawareApi')

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
