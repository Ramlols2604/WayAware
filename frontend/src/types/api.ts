export type TravelMode = 'walking' | 'driving'

export type PlaceSuggestion = {
  mapboxId: string
  label: string
  subtitle: string
  /** Provider attribution string; must be displayed alongside these results. */
  attribution: string
}

export type ResolvedPlace = {
  mapboxId: string
  name: string
  longitude: number
  latitude: number
  /** Provider attribution string; must be displayed alongside the selected place. */
  attribution: string
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

/** Sent with every along-route request. The map displays the window the response applied. */
export const HISTORICAL_REPORT_WINDOW = {
  start: '2006-06-01T00:00:00Z',
  end: '2026-06-01T00:00:00Z',
} as const

export const HISTORICAL_REPORT_RADIUS_M = 50
export const HISTORICAL_REPORT_LIMIT = 100

export type HistoricalReportWindow = {
  start: string
  end: string
}

export type HistoricalReportCategory = {
  kyCd: number
  offense: string
}

export type HistoricalReportCoverage = {
  categories: HistoricalReportCategory[]
  detail: string
}

export type HistoricalReport = {
  id: string
  offense: string
  description: string | null
  storedOccurredAt: string
  timeOfDayKnown: boolean
  distanceMeters: number
  latitude: number
  longitude: number
}

export type HistoricalReportResult = {
  window: HistoricalReportWindow
  returned: number
  truncated: boolean
  coverage: HistoricalReportCoverage
  timestampQuality: 'unverified'
  incidents: HistoricalReport[]
}

export type ExposureLevel = 'lower' | 'moderate' | 'higher'

export type ExposureCategoryCount = {
  kyCd: number
  offense: string
  count: number
}

export type ExposureSegment = {
  id: string
  coordinates: [number, number][]
  lengthMeters: number
  level: ExposureLevel
  totalCount: number
  categories: ExposureCategoryCount[]
}

export type RouteExposureResult = {
  assessmentStatus: 'assessed'
  window: HistoricalReportWindow
  radiusMeters: number
  coverage: HistoricalReportCoverage
  segments: ExposureSegment[]
}

export type ExposureStatus = 'idle' | 'loading' | 'ready' | 'error'

export type ExposureState = {
  requestId: number
  routeId: string | null
  status: ExposureStatus
  segments: ExposureSegment[]
  selectedId: string | null
  appliedWindow: HistoricalReportWindow | null
  coverage: HistoricalReportCoverage | null
}

export type HistoricalReportStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export type HistoricalReportState = {
  requestId: number
  routeId: string | null
  status: HistoricalReportStatus
  reports: HistoricalReport[]
  selectedId: string | null
  appliedWindow: HistoricalReportWindow | null
  coverage: HistoricalReportCoverage | null
  truncated: boolean
  returned: number
}
