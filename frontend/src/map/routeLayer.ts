import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { LineStringGeometry } from '../types/api'

const SOURCE_ID = 'wayaware-route'
const LAYER_ID = 'wayaware-route-line'

const emptyRoute = { type: 'FeatureCollection' as const, features: [] }

/**
 * Draws one route line on the existing map.
 * Green, yellow, and red segment colors are reserved for evidence-backed
 * safety data. This layer does not invent those colors.
 */
export function setRouteLine(map: MapLibreMap, geometry: LineStringGeometry | null) {
  const data = geometry
    ? { type: 'Feature' as const, properties: {}, geometry }
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
      'line-color': '#3B82F6',
      'line-width': 5,
      'line-opacity': 0.95,
    },
  })
}

export function fitRoute(map: MapLibreMap, geometry: LineStringGeometry) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const [longitude, latitude] of geometry.coordinates) {
    west = Math.min(west, longitude)
    south = Math.min(south, latitude)
    east = Math.max(east, longitude)
    north = Math.max(north, latitude)
  }
  if (!Number.isFinite(west)) return
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: { top: 210, bottom: 180, left: 28, right: 28 }, duration: 700, maxZoom: 15 },
  )
}
