export type TravelMode = 'walking' | 'driving'

export type PlaceSuggestion = {
  mapboxId: string
  label: string
  subtitle: string
}

export type ResolvedPlace = {
  mapboxId: string
  name: string
  longitude: number
  latitude: number
}

export type LineStringGeometry = {
  type: 'LineString'
  coordinates: [number, number][]
}

export type RouteSafety = 'safest' | 'fastest'

export type RouteAlternative = {
  id: string
  durationSeconds: number | null
  distanceMeters: number | null
  geometry: LineStringGeometry
  /** Set only when the backend response includes an explicit safety or preference field. */
  safety: RouteSafety | null
}

export type RouteEndpoints = {
  origin: { longitude: number; latitude: number }
  destination: { longitude: number; latitude: number }
  mode: TravelMode
}
