import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import PlaceSuggestions from './components/routing/PlaceSuggestions'
import RoutePanel from './components/routing/RoutePanel'
import TravelModeSelector from './components/routing/TravelModeSelector'
import { setRouteLine, fitRoute } from './map/routeLayer'
import { useRoutePlaces } from './routing/usePlaceSearch'
import { requestRoutes } from './api/wayawareApi'
import type { RouteAlternative, RouteSafety, TravelMode } from './types/api'

type Severity = 'major' | 'minor'
type IncidentIcon = 'fire' | 'shooting' | 'assault' | 'theft' | 'crash' | 'harassment' | 'robbery' | 'police'

type Incident = {
  id: string
  type: string
  severity: Severity
  lat: number
  lng: number
  location: string
  icon: IncidentIcon
}

const MANHATTAN = { lat: 40.7549, lng: -73.9857 }

/** Demo incidents only. These are not live NYC reports. */
const incidents: Incident[] = [
  {
    id: 'midtown-fire',
    type: 'Fire',
    severity: 'major',
    lat: 40.7561,
    lng: -73.9864,
    location: '145 W 42nd St, New York, NY',
    icon: 'fire',
  },
  {
    id: 'harlem-shooting',
    type: 'Shooting',
    severity: 'major',
    lat: 40.8044,
    lng: -73.9373,
    location: 'E 125th St & Lexington Ave, New York, NY',
    icon: 'shooting',
  },
  {
    id: 'herald-theft',
    type: 'Theft',
    severity: 'minor',
    lat: 40.7504,
    lng: -73.9896,
    location: '34th St & 7th Ave, New York, NY',
    icon: 'theft',
  },
  {
    id: 'forest-crash',
    type: 'Car Crash',
    severity: 'minor',
    lat: 40.7208,
    lng: -73.844,
    location: 'Queens Blvd & 71st Ave, Queens, NY',
    icon: 'crash',
  },
  {
    id: 'canal-harassment',
    type: 'Harassment',
    severity: 'minor',
    lat: 40.7191,
    lng: -74.0014,
    location: 'Canal St & Broadway, New York, NY',
    icon: 'harassment',
  },
  {
    id: 'brooklyn-assault',
    type: 'Serious Assault',
    severity: 'major',
    lat: 40.65,
    lng: -73.96,
    location: 'Flatbush Ave & Church Ave, Brooklyn, NY',
    icon: 'assault',
  },
  {
    id: 'jamaica-police',
    type: 'Police Activity',
    severity: 'minor',
    lat: 40.7022,
    lng: -73.788,
    location: 'Jamaica Ave & 160th St, Queens, NY',
    icon: 'police',
  },
  {
    id: 'coney-robbery',
    type: 'Robbery',
    severity: 'minor',
    lat: 40.574,
    lng: -73.986,
    location: 'Surf Ave & W 12th St, Brooklyn, NY',
    icon: 'robbery',
  },
]

const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

const MAJOR = '#EF4444'
const MINOR = '#F5C518'

const iconSvg: Record<IncidentIcon, string> = {
  fire: '<path fill="white" d="M12.1 1.6c.4 2.4 2.4 3.6 3 6 .4 1.7-.4 3.1-1.5 4 1.2-.2 2.6-1.2 3.1-2.9.2 3.4-2.1 6.5-5.6 6.5-3.7 0-6.1-2.8-6.1-6.2 0-2.1 1-3.4 1.8-4.6.6 1.4 1.3 1.8 2 1.7-.8-1.8-.4-3.4.3-5.2.6 1.5 1.6 2.1 2-.3.3.9.6 1.5 1 .4z"/>',
  shooting:
    '<path fill="white" d="M1.8 8.4h16.4c1.2 0 2.1 1 2.1 2.2v.3h-6.2l-1.6 2.7H9.6v6.2H6.2v-6.2H4.8L3.6 10.9H1.8V8.4z"/>',
  assault:
    '<circle cx="8.6" cy="7.4" r="2.7" fill="white"/><path fill="white" d="M4.2 19.8v-.6c.4-2.8 2.1-4.6 4.4-4.6s4 1.8 4.4 4.6v.6H4.2z"/><path stroke="white" stroke-width="1.8" stroke-linecap="round" d="M16 4.8 18.4 3.4M17.2 8.2h2.8M16 11.4l2.4 1.4"/>',
  theft:
    '<path fill="white" d="M8.4 8.6C8.7 5.4 10 3.5 12 3.5s3.3 1.9 3.6 5.1H8.4z"/><path fill="white" d="M2.6 10.4c2-.8 5.2-1.3 9.4-1.3s7.4.5 9.4 1.3c-1.8.7-5.2 1.2-9.4 1.2s-7.6-.5-9.4-1.2z"/><path fill="white" fill-rule="evenodd" d="M3.8 15.2c0-2 3.6-3.4 8.2-3.4s8.2 1.4 8.2 3.4-3.6 3.4-8.2 3.4-8.2-1.4-8.2-3.4zm3.2-.1a1.7 1.7 0 1 0 .02 0zm6.4 0a1.7 1.7 0 1 0 .02 0z"/>',
  crash:
    '<path fill="white" fill-rule="evenodd" d="M12 2.6 17.6 16.2H6.4L12 2.6zM8.2 11h7.6l.8 2.1H7.4L8.2 11z"/><path fill="white" d="M6.8 16.2h10.4v2.3c0 .6-.5 1.1-1.1 1.1H7.9c-.6 0-1.1-.5-1.1-1.1v-2.3z"/>',
  harassment:
    '<circle cx="8.4" cy="5.6" r="2.7" fill="white"/><path fill="white" d="M3.8 20.2c.3-3.1 2.1-5 4.6-5s4.3 1.9 4.6 5H3.8z"/><path fill="white" d="M22.2 6.4c-1.8 1.6-4.4 3.2-6.6 4-.7.2-.8 1.1-.2 1.5.7.4 1.5.1 2-.4 1.5-.9 3.6-2.2 4.8-3.4.5-.5.5-1.2 0-1.7z"/><ellipse cx="14.1" cy="12.7" rx="2.35" ry="1.55" fill="white"/>',
  robbery:
    '<path fill="white" fill-rule="evenodd" d="M7.2 8.2h8.4v11.2H7.2V8.2zm1.5 2.4h5.4v1.7H8.7v-1.7z"/><path fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" d="M15.6 10.2c2.6-.2 3.8 1.8 3 3.6"/><path stroke="white" stroke-width="1.7" stroke-linecap="round" d="M3.2 11.4h2.6M3.4 14.4h2.4"/>',
  police:
    '<path fill="white" fill-rule="evenodd" d="M12 2.2 18.6 4.7v5.6c0 4-2.6 6.5-6.6 8-4-1.5-6.6-4-6.6-8V4.7L12 2.2zm0 5.2.95 1.9 2.1.3-1.5 1.5.35 2.1L12 12.2l-1.9 1 .35-2.1-1.5-1.5 2.1-.3z"/>',
}

function severityColor(severity: Severity) {
  return severity === 'major' ? MAJOR : MINOR
}

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

function markerHtml(color: string, svg: string, selected: boolean) {
  const ring = selected
    ? 'box-shadow:0 0 0 4px rgba(255,255,255,.85), 0 6px 14px rgba(0,0,0,.4);'
    : 'box-shadow:0 6px 14px rgba(0,0,0,.35);'
  return `<div style="width:36px;height:36px;border-radius:999px;background:${color};display:flex;align-items:center;justify-content:center;border:2px solid white;cursor:pointer;${ring}"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="filter:drop-shadow(0 1px 0 rgba(0,0,0,.28))">${svg}</svg></div>`
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
  const [user, setUser] = useState(MANHATTAN)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ignoreMapClick = useRef(false)

  const selected = incidents.find((incident) => incident.id === selectedId) ?? null

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
        setSelectedId(null)
      })
      map.once('load', () => {
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
      for (const group of clusterIncidents(incidents, map)) {
        const lat = group.reduce((sum, item) => sum + item.lat, 0) / group.length
        const lng = group.reduce((sum, item) => sum + item.lng, 0) / group.length
        const element = document.createElement('div')
        if (group.length > 1) {
          element.innerHTML = clusterHtml(group.length)
        } else {
          const incident = group[0]
          element.innerHTML = markerHtml(severityColor(incident.severity), iconSvg[incident.icon], incident.id === selectedId)
          element.setAttribute('role', 'button')
          element.setAttribute('aria-label', incident.type)
        }
        if (group.length > 1) {
          element.setAttribute('role', 'button')
          element.setAttribute('aria-label', `${group.length} incidents`)
        }
        element.addEventListener('click', (event) => {
          event.stopPropagation()
          ignoreMapClick.current = true
          if (group.length > 1) {
            map.flyTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 16), duration: 450 })
            return
          }
          setSelectedId(group[0].id)
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
  }, [mapReady, selectedId, user])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    setRouteLine(map, selectedRoute?.geometry ?? null)
    if (selectedRoute) fitRoute(map, selectedRoute.geometry)
  }, [mapReady, selectedRoute])

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
              <div className="relative">
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
              <div className="relative">
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
            selected ? 'bottom-56' : routeStatus !== 'idle' ? 'bottom-52' : 'bottom-6'
          }`}
        >
          <LocateIcon />
        </button>

        {selected && (
          <IncidentSheet key={selected.id} incident={selected} onClose={() => setSelectedId(null)} />
        )}

        {!selected && (
          <RoutePanel
            status={routeStatus}
            routes={routes}
            selectedId={selectedRouteId}
            preference={routePreference}
            safetyRankingAvailable={safetyRankingAvailable}
            onSelect={setSelectedRouteId}
            onRetry={() => setRouteAttempt((attempt) => attempt + 1)}
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

function IncidentSheet({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      role="dialog"
      aria-label={incident.type}
      className={`pointer-events-auto absolute inset-x-0 bottom-0 z-20 rounded-t-3xl border border-b-0 border-[var(--wa-line)] bg-[var(--wa-card)] px-5 pt-5 pb-7 shadow-[var(--wa-sheet-shadow)] transition-transform duration-300 ease-out ${
        shown ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close incident"
        className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full text-[var(--wa-icon-faint)] hover:bg-[var(--wa-hover-strong)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
      >
        <CloseIcon />
      </button>

      <div className="flex flex-col items-center text-center">
        <span
          className="flex size-14 items-center justify-center rounded-full border-2 border-white shadow-[0_6px_14px_rgba(0,0,0,0.28)]"
          style={{ background: severityColor(incident.severity) }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg[incident.icon] }} />
        </span>
        <h2 className="mt-3 text-[1.85rem] leading-none font-bold text-[var(--wa-text)]" style={outfit}>
          {incident.type}
        </h2>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[0.92rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
          <SheetPin />
          {incident.location}
        </p>
        <p className="mt-1 text-[0.68rem] font-semibold tracking-[0.14em] text-[var(--wa-text-muted)] uppercase" style={outfit}>
          Demo data
        </p>
      </div>

      <button
        type="button"
        className="mt-5 w-full rounded-2xl py-3.5 text-[1.05rem] font-bold tracking-wide text-white focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:outline-none active:scale-[0.98]"
        style={{
          ...outfit,
          background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 60%, #60a5fa 100%)',
          boxShadow: '0 4px 24px rgba(59,130,246,0.4)',
        }}
      >
        More Information
      </button>
    </div>
  )
}

function SheetPin() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-[var(--wa-text-muted)]">
      <path d="M7 1.2a3.6 3.6 0 0 0-3.6 3.6c0 2.6 3.6 7 3.6 7s3.6-4.4 3.6-7A3.6 3.6 0 0 0 7 1.2z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="7" cy="4.7" r="1.15" fill="currentColor" />
    </svg>
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

function clusterIncidents(items: Incident[], map: maplibregl.Map) {
  const used = new Set<string>()
  const groups: Incident[][] = []
  for (const incident of items) {
    if (used.has(incident.id)) continue
    const point = map.project([incident.lng, incident.lat])
    const group = [incident]
    used.add(incident.id)
    for (const other of items) {
      if (used.has(other.id)) continue
      const otherPoint = map.project([other.lng, other.lat])
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

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
