import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import PlaceSuggestions from './components/routing/PlaceSuggestions'
import RoutePanel from './components/routing/RoutePanel'
import TravelModeSelector from './components/routing/TravelModeSelector'
import {
  ALTERNATIVE_HIT_LAYER_ID,
  ROUTE_HIT_LAYER_ID,
  alternativeIdFromClick,
  fitRoute,
  segmentHitFromClick,
  setAlternativeRoutes,
  setRouteSegments,
} from './map/routeLayer'
import { formatAppliedWindow } from './map/historicalReports'
import {
  COMPARISON_UNAVAILABLE_MESSAGE,
  NO_ALTERNATIVE_MESSAGE,
  NO_LOWER_EXPOSURE_MESSAGE,
  NO_ROUTE_SUMMARY_MATCH,
  ROUTE_SUMMARY_CONTEXT,
  ZERO_SEGMENT_MESSAGE,
  ROUTE_SUMMARY_LABEL,
  SEGMENT_DISTANCE_LABEL,
  SEGMENT_EXPLANATION,
  applyExposureError,
  applyExposureResponse,
  beginExposureRequest,
  comparisonIsCurrent,
  displayRouteCategories,
  displaySegmentCategories,
  exposureForRoute,
  exposureLevelLabel,
  fastestRouteId,
  idleExposure,
  lowerExposureRouteId,
  rerouteId,
  selectionForSegmentTap,
} from './map/routeExposure'
import { useRoutePlaces } from './routing/usePlaceSearch'
import { requestRouteComparison, requestRouteExposure, requestRoutes } from './api/wayawareApi'
import type { ExposureSegment, ExposureState, RouteAlternative, RouteSafety, TravelMode } from './types/api'

const MANHATTAN = { lat: 40.7549, lng: -73.9857 }
const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

function isInNyc(lat: number, lng: number) {
  return lat > 40.48 && lat < 40.93 && lng > -74.28 && lng < -73.68
}

function comparisonKey(routes: RouteAlternative[]) {
  return routes.map((route) => JSON.stringify(route.geometry.coordinates)).join('|')
}

function chooseDisplayedRoute(
  routes: RouteAlternative[],
  routeKey: string,
  routePreference: RouteSafety,
  comparisonStatus: 'idle' | 'loading' | 'ready' | 'error',
  comparisonWeights: number[] | null,
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

function userHtml() {
  return `<div style="width:46px;height:46px;position:relative"><div style="position:absolute;inset:0;border-radius:999px;background:rgba(59,130,246,.22)"></div><div style="position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:999px;background:#3B82F6;border:2.5px solid white;box-shadow:0 0 0 1px rgba(59,130,246,.35)"></div></div>`
}

function endpointElement(kind: 'origin' | 'destination') {
  const element = document.createElement('div')
  element.dataset.marker = kind
  element.style.pointerEvents = 'none'
  if (kind === 'origin') {
    element.setAttribute('aria-label', 'Route start')
    element.style.width = '16px'
    element.style.height = '16px'
    element.style.borderRadius = '999px'
    element.style.background = '#ffffff'
    element.style.border = '4px solid #3B82F6'
    element.style.boxShadow = '0 1px 4px rgba(0,0,0,.35)'
    return element
  }
  element.setAttribute('aria-label', 'Route end')
  element.style.width = '22px'
  element.style.height = '30px'
  element.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30" aria-hidden="true"><path d="M11 1.5a8 8 0 0 0-8 8c0 6 8 18 8 18s8-12 8-18a8 8 0 0 0-8-8z" fill="#3B82F6" stroke="white" stroke-width="1.5"/><circle cx="11" cy="9.5" r="2.6" fill="white"/></svg>'
  return element
}

function framePadding(map: maplibregl.Map, search: HTMLElement | null, panel: HTMLElement | null) {
  const mapRect = map.getContainer().getBoundingClientRect()
  const gap = 20
  const top = search ? Math.max(gap, search.getBoundingClientRect().bottom - mapRect.top + gap) : 180
  const bottom = panel ? Math.max(gap, mapRect.bottom - panel.getBoundingClientRect().top + gap) : 108
  return { top, bottom, left: 28, right: 28 }
}

type MapScreenProps = {
  active: boolean
  onOpenSettings: () => void
  onBack: () => void
  routePreference: RouteSafety
}

export default function MapScreen({ active, onOpenSettings, onBack, routePreference }: MapScreenProps) {
  const places = useRoutePlaces()
  const [travelMode, setTravelMode] = useState<TravelMode>('walking')
  const [routes, setRoutes] = useState<RouteAlternative[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [routeAttempt, setRouteAttempt] = useState(0)
  const [exposureAttempt, setExposureAttempt] = useState(0)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [manualChoice, setManualChoice] = useState<{ key: string; id: string; preference: RouteSafety } | null>(null)
  const [comparisonWeights, setComparisonWeights] = useState<number[] | null>(null)
  const [comparisonStatus, setComparisonStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [buttonNotice, setButtonNotice] = useState<{ key: string; text: string } | null>(null)
  const [exposure, setExposure] = useState<ExposureState>(idleExposure)
  const [user, setUser] = useState(MANHATTAN)
  const [mapReady, setMapReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const routeQueryRef = useRef('')
  const ignoreMapClick = useRef(false)
  const exposureRequestId = useRef(0)
  const comparisonRequestId = useRef(0)
  const loadedComparisonKey = useRef<string | null>(null)
  const preferenceRef = useRef(routePreference)
  preferenceRef.current = routePreference

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
  const visibleExposure = exposureForRoute(exposure, selectedRoute?.id ?? null)
  const tappedSegment = visibleExposure.segments.find((segment) => segment.id === visibleExposure.selectedId) ?? null
  const selectedSegment = tappedSegment && tappedSegment.level !== 'lower' ? tappedSegment : null
  const summaryVisible = summaryOpen && visibleExposure.routeId === selectedRoute?.id
  const selectedPlaceAttribution = places.destination.place?.attribution || places.origin.place?.attribution || null

  const routeQueryKey = places.origin.place && places.destination.place
    ? `${places.origin.place.longitude},${places.origin.place.latitude}|${places.destination.place.longitude},${places.destination.place.latitude}|${travelMode}`
    : ''

  useEffect(() => {
    const originPlace = places.origin.place
    const destinationPlace = places.destination.place
    routeQueryRef.current = ''
    if (!originPlace || !destinationPlace) {
      setRoutes([])
      setSelectedRouteId(null)
      setRouteStatus('idle')
      return
    }
    let cancelled = false
    const queryKey = routeQueryKey
    setRoutes([])
    setSelectedRouteId(null)
    setSummaryOpen(false)
    setRouteStatus('loading')
    requestRoutes({
      origin: { longitude: originPlace.longitude, latitude: originPlace.latitude },
      destination: { longitude: destinationPlace.longitude, latitude: destinationPlace.latitude },
      mode: travelMode,
    })
      .then((list) => {
        if (cancelled) return
        routeQueryRef.current = queryKey
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
  }, [places.origin.place, places.destination.place, routeQueryKey, travelMode, routeAttempt])

  const routeKey = comparisonKey(routes)

  useEffect(() => {
    if (!active) return
    mapRef.current?.resize()
  }, [active, mapReady])

  const chosenRouteId = chooseDisplayedRoute(
    routes,
    routeKey,
    routePreference,
    comparisonStatus,
    comparisonWeights,
    manualChoice,
  )
  if (chosenRouteId !== selectedRouteId) setSelectedRouteId(chosenRouteId)

  const noticeKey = `${routePreference}:${routeKey}`
  const routeNotice =
    comparisonStatus === 'error'
      ? COMPARISON_UNAVAILABLE_MESSAGE
      : buttonNotice?.key === noticeKey
        ? buttonNotice.text
        : routes.length === 1
          ? NO_ALTERNATIVE_MESSAGE
          : null

  useEffect(() => {
    if (routes.length < 2) {
      loadedComparisonKey.current = null
      comparisonRequestId.current += 1
      setComparisonWeights(null)
      setComparisonStatus('idle')
      return
    }
    if (loadedComparisonKey.current === routeKey) return
    loadedComparisonKey.current = null
    const requestId = comparisonRequestId.current + 1
    comparisonRequestId.current = requestId
    const requestedPreference = routePreference
    const controller = new AbortController()
    setComparisonWeights(null)
    setComparisonStatus('loading')
    requestRouteComparison(
      routes.map((route) => route.geometry),
      controller.signal,
    )
      .then((weights) => {
        if (
          !comparisonIsCurrent(
            requestId,
            comparisonRequestId.current,
            requestedPreference,
            preferenceRef.current,
          )
        ) {
          return
        }
        loadedComparisonKey.current = routeKey
        setComparisonWeights(weights)
        setComparisonStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        if (requestId !== comparisonRequestId.current) return
        setComparisonWeights(null)
        setComparisonStatus('error')
      })
    return () => controller.abort()
  }, [routeKey, routePreference, routes])

  useEffect(() => {
    setSummaryOpen(false)
  }, [selectedRoute?.id])

  const comparisonSettled = routes.length < 2 || comparisonStatus === 'ready' || comparisonStatus === 'error'

  useEffect(() => {
    const route = selectedRoute
    const geometry = route?.geometry
    if (!route || !geometry || !comparisonSettled) {
      const requestId = exposureRequestId.current + 1
      exposureRequestId.current = requestId
      setExposure(route ? beginExposureRequest(requestId, route.id) : { ...idleExposure, requestId })
      return
    }
    const requestId = exposureRequestId.current + 1
    exposureRequestId.current = requestId
    const controller = new AbortController()
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
  }, [comparisonSettled, exposureAttempt, selectedRoute])

  const selectDrawnRoute = useRef<(routeId: string) => void>(() => {})
  selectDrawnRoute.current = (routeId: string) => {
    if (!routes.some((route) => route.id === routeId) || routeId === selectedRouteId) return
    setButtonNotice(null)
    setSummaryOpen(false)
    setExposure((current) => (current.selectedId === null ? current : { ...current, selectedId: null }))
    setManualChoice({ key: routeKey, id: routeId, preference: routePreference })
    setSelectedRouteId(routeId)
  }

  function findLowerExposureRoute() {
    if (comparisonStatus === 'loading') return
    if (!selectedRoute || routes.length < 2) {
      setButtonNotice({ key: noticeKey, text: NO_ALTERNATIVE_MESSAGE })
      return
    }
    if (comparisonStatus !== 'ready' || !comparisonWeights) {
      setButtonNotice({ key: noticeKey, text: COMPARISON_UNAVAILABLE_MESSAGE })
      return
    }
    const next = rerouteId(routes, comparisonWeights, selectedRoute.id)
    if (!next) {
      setButtonNotice({ key: noticeKey, text: NO_LOWER_EXPOSURE_MESSAGE })
      return
    }
    setButtonNotice(null)
    setSummaryOpen(false)
    setExposure((current) => (current.selectedId === null ? current : { ...current, selectedId: null }))
    setManualChoice({ key: routeKey, id: next, preference: routePreference })
    setSelectedRouteId(next)
  }

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
        setSummaryOpen(false)
        setExposure((current) => ({ ...current, selectedId: null }))
      })
      map.once('load', () => {
        const loaded = map
        if (loaded) {
          setRouteSegments(loaded, null)
          setAlternativeRoutes(loaded, [])
          loaded.on('click', ALTERNATIVE_HIT_LAYER_ID, (event) => {
            if (loaded.queryRenderedFeatures(event.point, { layers: [ROUTE_HIT_LAYER_ID] }).length) return
            const routeId = alternativeIdFromClick(event)
            if (!routeId) return
            ignoreMapClick.current = true
            selectDrawnRoute.current(routeId)
          })
          loaded.on('mouseenter', ALTERNATIVE_HIT_LAYER_ID, () => {
            loaded.getCanvas().style.cursor = 'pointer'
          })
          loaded.on('mouseleave', ALTERNATIVE_HIT_LAYER_ID, () => {
            loaded.getCanvas().style.cursor = ''
          })
          loaded.on('click', ROUTE_HIT_LAYER_ID, (event) => {
            const hit = segmentHitFromClick(event)
            if (!hit) return
            ignoreMapClick.current = true
            const segmentId = selectionForSegmentTap(hit.level, hit.segmentId)
            if (!segmentId) {
              setExposure((current) => (current.selectedId === null ? current : { ...current, selectedId: null }))
              return
            }
            setSummaryOpen(false)
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
  }, [mapReady, user])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !selectedRoute || routeQueryRef.current !== routeQueryKey) return
    const geometry = selectedRoute.geometry
    const origin = places.origin.place
    const destination = places.destination.place
    const endpoints: [number, number][] = []
    if (origin) endpoints.push([origin.longitude, origin.latitude])
    if (destination) endpoints.push([destination.longitude, destination.latitude])
    const frame = requestAnimationFrame(() => {
      const current = mapRef.current
      if (!current || routeQueryRef.current !== routeQueryKey) return
      const others = routes.flatMap((route) =>
        route.id === selectedRoute.id ? [] : route.geometry.coordinates,
      )
      fitRoute(current, geometry, endpoints, framePadding(current, searchRef.current, panelRef.current), others)
    })
    return () => cancelAnimationFrame(frame)
  }, [mapReady, places.destination.place, places.origin.place, routeQueryKey, routes, selectedRoute])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const markers: maplibregl.Marker[] = []
    const origin = places.origin.place
    const destination = places.destination.place
    if (origin) {
      markers.push(
        new maplibregl.Marker({ element: endpointElement('origin'), anchor: 'center' })
          .setLngLat([origin.longitude, origin.latitude])
          .addTo(map),
      )
    }
    if (destination) {
      markers.push(
        new maplibregl.Marker({ element: endpointElement('destination'), anchor: 'bottom' })
          .setLngLat([destination.longitude, destination.latitude])
          .addTo(map),
      )
    }
    return () => {
      markers.forEach((marker) => marker.remove())
    }
  }, [mapReady, places.destination.place, places.origin.place])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    setAlternativeRoutes(
      map,
      routes
        .filter((route) => route.id !== selectedRoute?.id)
        .map((route) => ({ routeId: route.id, coordinates: route.geometry.coordinates })),
    )
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
  }, [mapReady, routes, selectedRoute, visibleExposure])

  return (
    <div className="absolute inset-0 bg-[#f8f8f8]">
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-0 z-10">
        <div ref={searchRef} className="pointer-events-auto absolute top-12 right-3 left-3 flex items-start gap-2">
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

        {selectedRoute && routeNotice && (
          <p
            role="status"
            className="pointer-events-auto absolute right-20 left-3 z-20 rounded-2xl border border-[var(--wa-line)] bg-[var(--wa-card)] px-3 py-2 text-[0.82rem] leading-snug text-[var(--wa-text)] shadow-[var(--wa-float-shadow)]"
            style={{
              ...inter,
              bottom: summaryVisible || selectedSegment
                ? 'calc(21.5rem + 3.25rem)'
                : 'calc(max(0.75rem, env(safe-area-inset-bottom, 0px)) + 12.875rem)',
            }}
          >
            {routeNotice}
          </p>
        )}

        {selectedRoute && (
          <button
            type="button"
            onClick={findLowerExposureRoute}
            disabled={comparisonStatus === 'loading'}
            aria-busy={comparisonStatus === 'loading'}
            aria-label="Find a lower-exposure route"
            className={`pointer-events-auto absolute right-3 flex size-12 items-center justify-center rounded-full border border-[var(--wa-line)] bg-[var(--wa-card)] text-[#3b82f6] shadow-[var(--wa-float-shadow)] transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none disabled:opacity-60 ${
              summaryVisible || selectedSegment ? 'bottom-[21.5rem]' : ''
            }`}
            style={
              summaryVisible || selectedSegment
                ? undefined
                : {
                    bottom: 'calc(max(0.75rem, env(safe-area-inset-bottom, 0px)) + 9.625rem)',
                  }
            }
          >
            <RerouteIcon />
          </button>
        )}

        <button
          type="button"
          onClick={recenter}
          aria-label="Recenter on your location"
          className={`pointer-events-auto absolute right-3 flex size-12 items-center justify-center rounded-full border border-[var(--wa-line)] bg-[var(--wa-card)] text-[#3b82f6] shadow-[var(--wa-float-shadow)] transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none ${
            summaryVisible || selectedSegment ? 'bottom-72' : ''
          }`}
          style={
            summaryVisible || selectedSegment
              ? undefined
              : {
                  bottom:
                    routeStatus === 'idle'
                      ? 'max(1.5rem, env(safe-area-inset-bottom, 0px))'
                      : 'calc(max(0.75rem, env(safe-area-inset-bottom, 0px)) + 6.125rem)',
                }
          }
        >
          <LocateIcon />
        </button>

        {selectedSegment && !summaryVisible && visibleExposure.appliedWindow && (
          <SegmentSummary
            key={selectedSegment.id}
            segment={selectedSegment}
            routeCategories={visibleExposure.routeCategories}
            windowLabel={formatAppliedWindow(visibleExposure.appliedWindow)}
            onClose={() => setExposure((current) => ({ ...current, selectedId: null }))}
          />
        )}

        {summaryVisible && (
          <RouteSummary
            status={visibleExposure.status}
            categories={displayRouteCategories(visibleExposure.routeCategories)}
            windowLabel={visibleExposure.appliedWindow ? formatAppliedWindow(visibleExposure.appliedWindow) : null}
            coverage={visibleExposure.coverage?.detail ?? null}
            onClose={() => setSummaryOpen(false)}
            onRetry={() => setExposureAttempt((attempt) => attempt + 1)}
          />
        )}

        {!summaryVisible && !selectedSegment && (
          <RoutePanel
            panelRef={panelRef}
            status={routeStatus}
            routes={routes}
            selectedId={selectedRouteId}
            onRetry={() => setRouteAttempt((attempt) => attempt + 1)}
            onOpenSummary={() => {
              setExposure((current) => ({ ...current, selectedId: null }))
              setSummaryOpen(true)
            }}
          />
        )}

        {!summaryVisible && !selectedSegment && (
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

function SegmentSummary({
  segment,
  routeCategories,
  windowLabel,
  onClose,
}: {
  segment: ExposureSegment
  routeCategories: ExposureSegment['categories']
  windowLabel: string
  onClose: () => void
}) {
  const [shown, setShown] = useState(false)
  const categories = displaySegmentCategories(segment.categories, routeCategories)

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
      {categories.length === 0 ? (
        <p className="mt-3 text-[0.9rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
          {NO_ROUTE_SUMMARY_MATCH}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {categories.map((category) => (
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

function RouteSummary({
  status,
  categories,
  windowLabel,
  coverage,
  onClose,
  onRetry,
}: {
  status: ExposureState['status']
  categories: ExposureSegment['categories']
  windowLabel: string | null
  coverage: string | null
  onClose: () => void
  onRetry: () => void
}) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      role="dialog"
      aria-label={ROUTE_SUMMARY_LABEL}
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
        {ROUTE_SUMMARY_LABEL}
      </h2>
      {status === 'loading' && (
        <p className="mt-3 text-[0.9rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          Loading route summary…
        </p>
      )}
      {status === 'error' && (
        <button type="button" onClick={onRetry} className="mt-3 text-left text-[0.9rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          Unable to load the route summary. Try again.
        </button>
      )}
      {status === 'ready' && categories.length === 0 && (
        <p className="mt-3 text-[0.9rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
          {ZERO_SEGMENT_MESSAGE}
        </p>
      )}
      {status === 'ready' && categories.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {categories.map((category) => (
            <li key={category.kyCd} className="flex items-baseline justify-between gap-3 text-[0.9rem]" style={inter}>
              <span className="text-[var(--wa-text)]">{category.offense}</span>
              <span className="shrink-0 font-semibold text-[var(--wa-text)]">{category.count.toLocaleString('en-US')}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[0.78rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
        {ROUTE_SUMMARY_CONTEXT}
      </p>
      {windowLabel && (
        <p className="mt-1 text-[0.78rem] text-[var(--wa-text-muted)]" style={inter}>
          {windowLabel}
        </p>
      )}
      {coverage && (
        <p className="mt-1 text-[0.78rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
          {coverage}
        </p>
      )}
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

function RerouteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 16.5 16.5 7M16.5 7H13M16.5 7v3.5M17 7.5 7.5 17M7.5 17H11M7.5 17v-3.5" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
