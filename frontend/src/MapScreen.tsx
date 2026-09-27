import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import PlaceSuggestions from './components/routing/PlaceSuggestions'
import RoutePanel from './components/routing/RoutePanel'
import TravelModeSelector from './components/routing/TravelModeSelector'
import { ROUTE_HIT_LAYER_ID, fitRoute, segmentIdFromClick, setRouteSegments } from './map/routeLayer'
import {
  EMPTY_REPORTS_MESSAGE,
  applyHistoricalReportError,
  applyHistoricalReportResponse,
  beginHistoricalReportRequest,
  formatAppliedWindow,
  reportsForRoute,
  formatStoredReportDate,
  idleHistoricalReports,
  truncatedReportsMessage,
} from './map/historicalReports'
import {
  COLOR_EXPLANATION,
  SEGMENT_DISTANCE_LABEL,
  SEGMENT_EXPLANATION,
  ZERO_SEGMENT_MESSAGE,
  applyExposureError,
  applyExposureResponse,
  beginExposureRequest,
  exposureForRoute,
  exposureLevelLabel,
  idleExposure,
} from './map/routeExposure'
import { useRoutePlaces } from './routing/usePlaceSearch'
import { requestAlongRoute, requestRouteExposure, requestRoutes } from './api/wayawareApi'
import type { ExposureSegment, ExposureState, HistoricalReport, HistoricalReportState, RouteAlternative, RouteSafety, TravelMode } from './types/api'

const MANHATTAN = { lat: 40.7549, lng: -73.9857 }
const HISTORICAL_MARKER = '#334155'
const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

function chooseRoute(list: RouteAlternative[], preference: RouteSafety) {
  if (!list.length) return null
  if (preference === 'fastest') {
    return [...list].sort((a, b) => (a.durationSeconds ?? Number.POSITIVE_INFINITY) - (b.durationSeconds ?? Number.POSITIVE_INFINITY))[0].id
  }
  return list.find((route) => route.safety === 'safest')?.id ?? list[0].id
}

function isInNyc(lat: number, lng: number) {
  return lat > 40.48 && lat < 40.93 && lng > -74.28 && lng < -73.68
}

function historicalMarkerHtml(selected: boolean) {
  const ring = selected
    ? 'box-shadow:0 0 0 4px rgba(255,255,255,.85), 0 6px 14px rgba(0,0,0,.4);'
    : 'box-shadow:0 6px 14px rgba(0,0,0,.35);'
  return `<div style="width:28px;height:28px;border-radius:999px;background:${HISTORICAL_MARKER};border:2px solid white;cursor:pointer;${ring}"></div>`
}

function clusterHtml(count: number) {
  return `<div style="width:36px;height:36px;border-radius:999px;background:#0c1630;color:white;border:2px solid white;display:flex;align-items:center;justify-content:center;font-family:Outfit,sans-serif;font-weight:700;font-size:14px;box-shadow:0 8px 18px rgba(0,0,0,.45)">${count}</div>`
}

function userHtml() {
  return `<div style="width:46px;height:46px;position:relative"><div style="position:absolute;inset:0;border-radius:999px;background:rgba(59,130,246,.22)"></div><div style="position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:999px;background:#3B82F6;border:2.5px solid white;box-shadow:0 0 0 1px rgba(59,130,246,.35)"></div></div>`
}

type MapScreenProps = {
  onOpenSettings: () => void
  onBack: () => void
  routePreference: RouteSafety
}

export default function MapScreen({ onOpenSettings, onBack, routePreference }: MapScreenProps) {
  const places = useRoutePlaces()
  const [travelMode, setTravelMode] = useState<TravelMode>('walking')
  const [routes, setRoutes] = useState<RouteAlternative[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [routeAttempt, setRouteAttempt] = useState(0)
  const [reportAttempt, setReportAttempt] = useState(0)
  const [reports, setReports] = useState<HistoricalReportState>(idleHistoricalReports)
  const [exposureAttempt, setExposureAttempt] = useState(0)
  const [exposure, setExposure] = useState<ExposureState>(idleExposure)
  const [colorHelpOpen, setColorHelpOpen] = useState(false)
  const [user, setUser] = useState(MANHATTAN)
  const [mapReady, setMapReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ignoreMapClick = useRef(false)
  const reportRequestId = useRef(0)
  const exposureRequestId = useRef(0)

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude }
        if (isInNyc(next.lat, next.lng)) setUser(next)
      },
      () => {},
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    )
  }, [])

  function swapLocations() {
    places.swap()
  }

  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null
  const visibleReports = reportsForRoute(reports, selectedRoute?.id ?? null)
  const visibleExposure = exposureForRoute(exposure, selectedRoute?.id ?? null)
  const selected = visibleReports.reports.find((report) => report.id === visibleReports.selectedId) ?? null
  const selectedSegment = visibleExposure.segments.find((segment) => segment.id === visibleExposure.selectedId) ?? null
  const safetyRankingAvailable = routes.some((route) => route.safety !== null)
  const selectedPlaceAttribution = places.destination.place?.attribution || places.origin.place?.attribution || null

  useEffect(() => {
    const originPlace = places.origin.place
    const destinationPlace = places.destination.place
    if (!originPlace || !destinationPlace) {
      setRoutes([])
      setSelectedRouteId(null)
      setRouteStatus('idle')
      return
    }
    let cancelled = false
    setRouteStatus('loading')
    requestRoutes({
      origin: { longitude: originPlace.longitude, latitude: originPlace.latitude },
      destination: { longitude: destinationPlace.longitude, latitude: destinationPlace.latitude },
      mode: travelMode,
    })
      .then((list) => {
        if (cancelled) return
        setRoutes(list)
        setRouteStatus(list.length ? 'ready' : 'empty')
        if (!list.length) setSelectedRouteId(null)
      })
      .catch(() => {
        if (cancelled) return
        setRouteStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [places.origin.place, places.destination.place, travelMode, routeAttempt])

  useEffect(() => {
    if (!routes.length) return
    setSelectedRouteId(chooseRoute(routes, routePreference))
  }, [routePreference, routes])

  useEffect(() => {
    const route = selectedRoute
    const geometry = route?.geometry
    if (!route || !geometry) {
      const requestId = reportRequestId.current + 1
      reportRequestId.current = requestId
      setReports({ ...idleHistoricalReports, requestId })
      return
    }
    const requestId = reportRequestId.current + 1
    reportRequestId.current = requestId
    const controller = new AbortController()
    setReports(beginHistoricalReportRequest(requestId, route.id))
    requestAlongRoute(geometry, controller.signal)
      .then((response) => {
        setReports((current) => applyHistoricalReportResponse(current, requestId, response))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        setReports((current) => applyHistoricalReportError(current, requestId))
      })
    return () => {
      controller.abort()
    }
  }, [selectedRoute, reportAttempt])

  useEffect(() => {
    const route = selectedRoute
    const geometry = route?.geometry
    if (!route || !geometry) {
      const requestId = exposureRequestId.current + 1
      exposureRequestId.current = requestId
      setExposure({ ...idleExposure, requestId })
      return
    }
    const requestId = exposureRequestId.current + 1
    exposureRequestId.current = requestId
    const controller = new AbortController()
    setColorHelpOpen(false)
    setExposure(beginExposureRequest(requestId, route.id))
    requestRouteExposure(geometry, controller.signal)
      .then((response) => {
        setExposure((current) => applyExposureResponse(current, requestId, response))
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        setExposure((current) => applyExposureError(current, requestId))
      })
    return () => {
      controller.abort()
    }
  }, [selectedRoute, exposureAttempt])

  function recenter() {
    const map = mapRef.current
    if (!map) return
    map.flyTo({
      center: [user.lng, user.lat],
      zoom: Math.max(map.getZoom(), 14),
      duration: 600,
    })
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let map: maplibregl.Map | null = null
    let cancelled = false

    loadGoogleStyle().then((style) => {
      if (cancelled || !containerRef.current) return
      map = new maplibregl.Map({
        container,
        style,
        center: [-73.98, 40.71],
        zoom: 10,
        minZoom: 9,
        maxZoom: 18,
        attributionControl: false,
      })
      mapRef.current = map
      map.on('click', () => {
        if (ignoreMapClick.current) {
          ignoreMapClick.current = false
          return
        }
        setReports((current) => ({ ...current, selectedId: null }))
        setExposure((current) => ({ ...current, selectedId: null }))
      })
      map.once('load', () => {
        const loaded = map
        if (loaded) {
          setRouteSegments(loaded, null)
          loaded.on('click', ROUTE_HIT_LAYER_ID, (event) => {
            const segmentId = segmentIdFromClick(event)
            if (!segmentId) return
            ignoreMapClick.current = true
            setReports((current) => ({ ...current, selectedId: null }))
            setExposure((current) =>
              current.status === 'ready' ? { ...current, selectedId: segmentId } : current,
            )
          })
          loaded.on('mouseenter', ROUTE_HIT_LAYER_ID, () => {
            loaded.getCanvas().style.cursor = 'pointer'
          })
          loaded.on('mouseleave', ROUTE_HIT_LAYER_ID, () => {
            loaded.getCanvas().style.cursor = ''
          })
        }
        map?.fitBounds(
          [
            [-74.255, 40.496],
            [-73.7, 40.917],
          ],
          { padding: { top: 168, bottom: 28, left: 16, right: 16 }, animate: false },
        )
        setMapReady(true)
      })
    })

    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const markers: maplibregl.Marker[] = []

    const place = () => {
      markers.forEach((marker) => marker.remove())
      markers.length = 0
      for (const group of clusterReports(visibleReports.reports, map)) {
        const lat = group.reduce((sum, item) => sum + item.latitude, 0) / group.length
        const lng = group.reduce((sum, item) => sum + item.longitude, 0) / group.length
        const element = document.createElement('div')
        if (group.length > 1) {
          element.innerHTML = clusterHtml(group.length)
          element.setAttribute('role', 'button')
          element.setAttribute('aria-label', `${group.length} historical reports`)
        } else {
          const report = group[0]
          element.innerHTML = historicalMarkerHtml(report.id === visibleReports.selectedId)
          element.setAttribute('role', 'button')
          element.setAttribute('aria-label', `Historical ${report.offense}`)
        }
        element.addEventListener('click', (event) => {
          event.stopPropagation()
          ignoreMapClick.current = true
          if (group.length > 1) {
            map.flyTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 16), duration: 450 })
            return
          }
          setReports((current) => ({ ...current, selectedId: group[0].id }))
        })
        markers.push(new maplibregl.Marker({ element, anchor: 'center' }).setLngLat([lng, lat]).addTo(map))
      }

      const userElement = document.createElement('div')
      userElement.innerHTML = userHtml()
      markers.push(
        new maplibregl.Marker({ element: userElement, anchor: 'center' }).setLngLat([user.lng, user.lat]).addTo(map),
      )
    }

    place()
    map.on('moveend', place)
    return () => {
      map.off('moveend', place)
      markers.forEach((marker) => marker.remove())
    }
  }, [mapReady, visibleReports.reports, visibleReports.selectedId, user])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (selectedRoute) fitRoute(map, selectedRoute.geometry)
  }, [mapReady, selectedRoute])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const geometry = selectedRoute?.geometry
    if (!geometry || visibleExposure.status !== 'ready') {
      setRouteSegments(
        map,
        geometry
          ? [{ segmentId: '', level: 'unavailable', coordinates: geometry.coordinates }]
          : null,
      )
      return
    }
    setRouteSegments(
      map,
      visibleExposure.segments.map((segment) => ({
        segmentId: segment.id,
        level: segment.level,
        coordinates: segment.coordinates,
      })),
    )
  }, [mapReady, selectedRoute, visibleExposure])

  return (
    <div className="absolute inset-0 bg-[#f8f8f8]">
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-0 z-10">
        <div className="pointer-events-auto absolute top-12 right-3 left-3 flex items-start gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[var(--wa-line)] bg-[var(--wa-card)] text-[var(--wa-text)] shadow-[var(--wa-float-shadow)] transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
          >
            <BackChevron />
          </button>
          <div className="flex min-w-0 flex-1 items-stretch gap-2 rounded-2xl border border-[var(--wa-line)] bg-[var(--wa-card)] px-3 py-2 shadow-[var(--wa-card-shadow)]">
            <div className="flex w-5 shrink-0 flex-col items-center py-2.5">
              <span className="size-2.5 rounded-full border-2 border-[#3b82f6] bg-[#3b82f6]/30" />
              <span className="my-1 w-px flex-1 bg-[var(--wa-divider)]" />
              <DestinationPin />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className={`relative ${places.origin.status !== 'idle' ? 'z-20' : ''}`}>
                <input
                  value={places.origin.text}
                  onChange={(event) => places.origin.setText(event.target.value)}
                  placeholder="Your location"
                  aria-label="Your location"
                  className="h-11 w-full border-b border-[var(--wa-line)] bg-transparent text-[0.95rem] font-semibold text-[var(--wa-text)] outline-none placeholder:font-medium placeholder:text-[var(--wa-text-muted)]"
                  style={outfit}
                />
                <PlaceSuggestions
                  status={places.origin.status}
                  suggestions={places.origin.suggestions}
                  onSelect={places.origin.select}
                  onRetry={places.origin.retry}
                />
              </div>
              <div className={`relative ${places.destination.status !== 'idle' ? 'z-20' : ''}`}>
                <input
                  value={places.destination.text}
                  onChange={(event) => places.destination.setText(event.target.value)}
                  placeholder="Where to?"
                  aria-label="Where to?"
                  className="h-11 w-full bg-transparent text-[0.95rem] font-semibold text-[var(--wa-text)] outline-none placeholder:font-medium placeholder:text-[var(--wa-text-muted)]"
                  style={outfit}
                />
                <PlaceSuggestions
                  status={places.destination.status}
                  suggestions={places.destination.suggestions}
                  onSelect={places.destination.select}
                  onRetry={places.destination.retry}
                />
              </div>
              <TravelModeSelector mode={travelMode} onChange={setTravelMode} />
              {selectedPlaceAttribution && (
                <p
                  className="mt-1 truncate text-[0.68rem] text-[var(--wa-text-muted)]"
                  style={inter}
                  title={selectedPlaceAttribution}
                >
                  {selectedPlaceAttribution}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={swapLocations}
              aria-label="Swap start and destination"
              className="my-auto flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--wa-icon-soft)] transition-colors hover:bg-[var(--wa-hover-strong)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
            >
              <SwapIcon />
            </button>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[var(--wa-line)] bg-[var(--wa-card)] text-[var(--wa-gear)] shadow-[var(--wa-float-shadow)] transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
          >
            <GearIcon />
          </button>
        </div>

        <button
          type="button"
          onClick={recenter}
          aria-label="Recenter on your location"
          className={`pointer-events-auto absolute right-3 flex size-12 items-center justify-center rounded-full border border-[var(--wa-line)] bg-[var(--wa-card)] text-[#3b82f6] shadow-[var(--wa-float-shadow)] transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none ${
            selected || selectedSegment ? 'bottom-72' : routeStatus === 'ready' ? 'bottom-80' : routeStatus !== 'idle' ? 'bottom-52' : 'bottom-6'
          }`}
        >
          <LocateIcon />
        </button>

        {selectedSegment && visibleExposure.appliedWindow && (
          <SegmentSummary
            key={selectedSegment.id}
            segment={selectedSegment}
            windowLabel={formatAppliedWindow(visibleExposure.appliedWindow)}
            onClose={() => setExposure((current) => ({ ...current, selectedId: null }))}
          />
        )}

        {selected && !selectedSegment && (
          <IncidentSheet key={selected.id} report={selected} onClose={() => setReports((current) => ({ ...current, selectedId: null }))} />
        )}

        {!selected && !selectedSegment && (
          <RoutePanel
            status={routeStatus}
            routes={routes}
            selectedId={selectedRouteId}
            preference={routePreference}
            safetyRankingAvailable={safetyRankingAvailable}
            onSelect={setSelectedRouteId}
            onRetry={() => setRouteAttempt((attempt) => attempt + 1)}
            notice={
              <>
                <RouteColorControl
                  open={colorHelpOpen}
                  failed={visibleExposure.status === 'error'}
                  onToggle={() => setColorHelpOpen((open) => !open)}
                  onRetry={() => setExposureAttempt((attempt) => attempt + 1)}
                />
                <HistoricalReportNotice state={visibleReports} onRetry={() => setReportAttempt((attempt) => attempt + 1)} />
              </>
            }
          />
        )}

        {!selected && (
        <p className="pointer-events-auto absolute bottom-1 left-2 text-[9px] text-[#3c4043]/70" style={inter}>
          <a className="underline-offset-2 hover:text-[#3c4043]" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            © OpenStreetMap
          </a>
        </p>
        )}
      </div>
    </div>
  )
}

function RouteColorControl({
  open,
  failed,
  onToggle,
  onRetry,
}: {
  open: boolean
  failed: boolean
  onToggle: () => void
  onRetry: () => void
}) {
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-label="About route colors"
        aria-expanded={open}
        onClick={onToggle}
        className="flex size-8 items-center justify-center rounded-full text-[var(--wa-icon-soft)] hover:bg-[var(--wa-hover-strong)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
      >
        <InfoIcon />
      </button>
      {open && (
        <p className="mt-1 text-[0.78rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
          {COLOR_EXPLANATION}
        </p>
      )}
      {failed && (
        <button type="button" onClick={onRetry} className="mt-1 text-left text-[0.84rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          Route colors unavailable. Try again.
        </button>
      )}
    </div>
  )
}

function SegmentSummary({
  segment,
  windowLabel,
  onClose,
}: {
  segment: ExposureSegment
  windowLabel: string
  onClose: () => void
}) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      role="dialog"
      aria-label="Most reported nearby"
      className={`pointer-events-auto absolute z-20 border border-[var(--wa-line)] bg-[var(--wa-card)] px-5 pt-5 pb-6 shadow-[var(--wa-sheet-shadow)] transition-transform duration-300 ease-out max-[479px]:inset-x-0 max-[479px]:bottom-0 max-[479px]:rounded-t-3xl max-[479px]:border-b-0 min-[480px]:inset-x-3 min-[480px]:bottom-3 min-[480px]:rounded-3xl ${
        shown ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close summary"
        className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-[var(--wa-icon-faint)] hover:bg-[var(--wa-hover-strong)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
      >
        <CloseIcon />
      </button>
      <h2 className="pr-10 text-[1.25rem] leading-tight font-bold text-[var(--wa-text)]" style={outfit}>
        Most reported nearby
      </h2>
      <p className="mt-1 text-[0.92rem] font-semibold text-[var(--wa-text)]" style={outfit}>
        {exposureLevelLabel(segment.level)}
      </p>
      {segment.totalCount === 0 ? (
        <p className="mt-3 text-[0.9rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
          {ZERO_SEGMENT_MESSAGE}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {segment.categories.map((category) => (
            <li key={category.kyCd} className="flex items-baseline justify-between gap-3 text-[0.9rem]" style={inter}>
              <span className="text-[var(--wa-text)]">{category.offense}</span>
              <span className="shrink-0 font-semibold text-[var(--wa-text)]">{category.count.toLocaleString('en-US')}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[0.78rem] text-[var(--wa-text-muted)]" style={inter}>
        {windowLabel}
      </p>
      <p className="mt-1 text-[0.78rem] text-[var(--wa-text-muted)]" style={inter}>
        {SEGMENT_DISTANCE_LABEL}
      </p>
      <p className="mt-1 text-[0.78rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
        {SEGMENT_EXPLANATION}
      </p>
    </div>
  )
}

function HistoricalReportNotice({ state, onRetry }: { state: HistoricalReportState; onRetry: () => void }) {
  if (state.status === 'idle') return null
  const categoryNames = state.coverage?.categories.map((category) => category.offense).join(', ')
  return (
    <div className="mt-3 border-t border-[var(--wa-line)] pt-3">
      <p className="text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--wa-text-muted)] uppercase" style={outfit}>
        Historical
      </p>
      {state.status === 'loading' && (
        <p className="mt-1 text-[0.84rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          Loading historical reports…
        </p>
      )}
      {state.status === 'error' && (
        <button type="button" onClick={onRetry} className="mt-1 text-left text-[0.84rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          Unable to load historical reports. Try again.
        </button>
      )}
      {state.status === 'empty' && (
        <p className="mt-1 text-[0.84rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          {EMPTY_REPORTS_MESSAGE}
        </p>
      )}
      {state.status === 'ready' && state.truncated && (
        <p className="mt-1 text-[0.84rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          {truncatedReportsMessage(state.returned)}
        </p>
      )}
      {state.appliedWindow && (
        <p className="mt-1 text-[0.78rem] text-[var(--wa-text-muted)]" style={inter}>
          {formatAppliedWindow(state.appliedWindow)}
        </p>
      )}
      {state.coverage && (
        <>
          <p className="mt-1 text-[0.78rem] text-[var(--wa-text-muted)]" style={inter}>
            {state.coverage.detail}
          </p>
          {categoryNames && (
            <p className="mt-1 text-[0.78rem] text-[var(--wa-text-muted)]" style={inter}>
              {categoryNames}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function IncidentSheet({ report, onClose }: { report: HistoricalReport; onClose: () => void }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      role="dialog"
      aria-label={`Historical ${report.offense}`}
      className={`pointer-events-auto absolute inset-x-0 bottom-0 z-20 rounded-t-3xl border border-b-0 border-[var(--wa-line)] bg-[var(--wa-card)] px-5 pt-5 pb-7 shadow-[var(--wa-sheet-shadow)] transition-transform duration-300 ease-out ${
        shown ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close report"
        className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-[var(--wa-icon-faint)] hover:bg-[var(--wa-hover-strong)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
      >
        <CloseIcon />
      </button>

      <div className="flex flex-col items-center text-center">
        <span
          className="size-14 rounded-full border-2 border-white shadow-[0_6px_14px_rgba(0,0,0,0.28)]"
          style={{ background: HISTORICAL_MARKER }}
        />
        <h2 className="mt-3 text-[1.55rem] leading-tight font-bold text-[var(--wa-text)]" style={outfit}>
          {report.offense}
        </h2>
        {report.description && (
          <p className="mt-2 text-[0.92rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
            {report.description}
          </p>
        )}
        <p className="mt-2 text-[0.92rem] text-[var(--wa-text-muted)]" style={inter}>
          {Math.round(report.distanceMeters)} m from the route
        </p>
        <p className="mt-1 text-[0.92rem] text-[var(--wa-text-muted)]" style={inter}>
          Stored date {formatStoredReportDate(report.storedOccurredAt)}. Time of day unverified.
        </p>
        <p className="mt-1 text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--wa-text-muted)] uppercase" style={outfit}>
          Historical
        </p>
      </div>
    </div>
  )
}

const LAND = '#f8f8f8'
const WATER = '#90d8f0'
const PARK = '#c0f0d0'
const ROAD = '#ffffff'
const CASING = '#d9d9d9'

let googleStyleRequest: Promise<StyleSpecification> | null = null

function loadGoogleStyle() {
  if (!googleStyleRequest) {
    googleStyleRequest = fetch('https://tiles.openfreemap.org/styles/bright')
      .then((response) => response.json())
      .then((style: StyleSpecification) => style)
  }
  return googleStyleRequest.then((style) => applyGoogleColors(structuredClone(style)))
}

function applyGoogleColors(style: StyleSpecification) {
  for (const layer of style.layers) {
    const id = layer.id
    if (layer.type === 'background') {
      layer.paint = { ...layer.paint, 'background-color': LAND }
      continue
    }
    if (layer.type !== 'fill' && layer.type !== 'line') continue
    const paint = { ...(layer.paint ?? {}) } as Record<string, unknown>
    const color = googleColor(id, layer.type)
    if (!color) continue
    if (layer.type === 'fill') paint['fill-color'] = color
    if (layer.type === 'line') paint['line-color'] = color
    if (layer.type === 'fill' && paint['fill-outline-color'] && /park|grass|wood/.test(id)) {
      paint['fill-outline-color'] = '#b7ebc8'
    }
    if (layer.type === 'fill' && paint['fill-outline-color'] && /building/.test(id)) {
      paint['fill-outline-color'] = '#e4e4e4'
    }
    layer.paint = paint as typeof layer.paint
  }
  return style
}

function googleColor(id: string, type: 'fill' | 'line') {
  if (/waterway/.test(id)) return type === 'line' ? '#7ecae6' : WATER
  if (/water/.test(id)) return WATER
  if (/park|grass|wood|garden|pitch|cemetery|forest/.test(id)) return PARK
  if (/^highway-/.test(id) && !/name|shield|oneway/.test(id)) {
    if (id.includes('path')) return '#d5d5d5'
    return id.includes('casing') ? CASING : ROAD
  }
  if (/building/.test(id) && type === 'fill') return '#eeeeee'
  if (/landuse|landcover/.test(id) && type === 'fill' && !/park|grass|wood|water/.test(id)) return '#f4f4f4'
  return null
}

function clusterReports(items: HistoricalReport[], map: maplibregl.Map) {
  const used = new Set<string>()
  const groups: HistoricalReport[][] = []
  for (const report of items) {
    if (used.has(report.id)) continue
    const point = map.project([report.longitude, report.latitude])
    const group = [report]
    used.add(report.id)
    for (const other of items) {
      if (used.has(other.id)) continue
      const otherPoint = map.project([other.longitude, other.latitude])
      const dx = point.x - otherPoint.x
      const dy = point.y - otherPoint.y
      if (dx * dx + dy * dy < 4 * 4) {
        group.push(other)
        used.add(other.id)
      }
    }
    groups.push(group)
  }
  return groups
}

function DestinationPin() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden="true">
      <path d="M7 1.2a4.3 4.3 0 0 0-4.3 4.3c0 3.2 4.3 8.3 4.3 8.3s4.3-5.1 4.3-8.3A4.3 4.3 0 0 0 7 1.2z" fill="#d1d5db" />
      <circle cx="7" cy="5.4" r="1.5" fill="var(--wa-pin-hole)" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5 3.5v9M5 3.5L2.8 5.7M5 3.5l2.2 2.2M13 14.5v-9M13 14.5l-2.2-2.2M13 14.5l2.2-2.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BackChevron() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M13.5 5.5L8 11l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.2 2.8h3.6l.5 2.2a7.2 7.2 0 0 1 1.8.9l2-1.1 2.5 2.5-1.1 2a7.2 7.2 0 0 1 .9 1.8l2.2.5v3.6l-2.2.5a7.2 7.2 0 0 1-.9 1.8l1.1 2-2.5 2.5-2-1.1a7.2 7.2 0 0 1-1.8.9l-.5 2.2h-3.6l-.5-2.2a7.2 7.2 0 0 1-1.8-.9l-2 1.1-2.5-2.5 1.1-2a7.2 7.2 0 0 1-.9-1.8l-2.2-.5v-3.6l2.2-.5a7.2 7.2 0 0 1 .9-1.8l-1.1-2 2.5-2.5 2 1.1a7.2 7.2 0 0 1 1.8-.9l.5-2.2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function LocateIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="3" fill="#3b82f6" />
      <path d="M11 2.5v2.2M11 17.3v2.2M2.5 11h2.2M17.3 11h2.2" stroke="#3b82f6" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="11" cy="11" r="6.2" stroke="#3b82f6" strokeWidth="1.6" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 8.1V12.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="6" r="0.8" fill="currentColor" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
