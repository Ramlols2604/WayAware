import type { RouteAlternative } from '../../types/api'
import { ROUTE_SUMMARY_LABEL } from '../../map/routeExposure'

const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

type RoutePanelProps = {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  routes: RouteAlternative[]
  selectedId: string | null
  onSelect: (routeId: string) => void
  onRetry: () => void
  onOpenSummary: () => void
}

export default function RoutePanel({ status, routes, selectedId, onSelect, onRetry, onOpenSummary }: RoutePanelProps) {
  if (status === 'idle') return null
  const selected = routes.find((route) => route.id === selectedId) ?? routes[0]
  const box = 'rounded-3xl border border-[var(--wa-line)] bg-[var(--wa-card)] shadow-[var(--wa-sheet-shadow)]'

  return (
    <div
      className="pointer-events-auto grid w-full items-stretch gap-2"
      style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 3fr)' }}
    >
      {status === 'loading' && <p className={`${box} col-span-2 px-4 py-2.5 text-[0.95rem] leading-5 font-semibold text-[var(--wa-text)]`} style={outfit}>Finding your route…</p>}
      {status === 'empty' && <p className={`${box} col-span-2 px-4 py-2.5 text-[0.95rem] leading-5 font-semibold text-[var(--wa-text)]`} style={outfit}>No route available for this trip.</p>}
      {status === 'error' && (
        <button type="button" onClick={onRetry} className={`${box} col-span-2 px-4 py-2.5 text-left text-[0.95rem] leading-5 font-semibold text-[var(--wa-text)]`} style={outfit}>
          Unable to load route. Try again.
        </button>
      )}
      {status === 'ready' && selected && (
        <>
          {routes.length > 1 && (
            <div className="col-span-2 flex gap-2" role="group" aria-label="Routes">
              {routes.map((route, index) => {
                const label = String.fromCharCode(65 + index)
                const selectedRoute = route.id === selectedId
                return (
                  <button
                    key={route.id}
                    type="button"
                    aria-pressed={selectedRoute}
                    aria-label={`Route ${label}`}
                    onClick={() => onSelect(route.id)}
                    className={`${box} flex-1 px-3 py-2 text-[0.95rem] font-semibold focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none ${
                      selectedRoute ? 'ring-2 ring-[#3b82f6]' : ''
                    }`}
                    style={outfit}
                  >
                    {label} · {formatDuration(route.durationSeconds)}
                  </button>
                )
              })}
            </div>
          )}
          <div className={`${box} flex flex-col items-center justify-center px-3 py-3.5 text-center`}>
            <p className="text-[1.05rem] leading-6 font-semibold text-[var(--wa-text)]" style={outfit}>
              {formatDuration(selected.durationSeconds)}
            </p>
            <p className="text-[0.95rem] leading-5 text-[var(--wa-text-muted)]" style={inter}>
              {formatDistance(selected.distanceMeters)}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenSummary}
            className={`${box} flex items-center justify-center px-4 py-3.5 text-center text-[1.05rem] leading-snug font-semibold text-[var(--wa-text)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none`}
            style={outfit}
          >
            {ROUTE_SUMMARY_LABEL}
          </button>
        </>
      )}
    </div>
  )
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`
}

function formatDistance(meters: number | null) {
  if (meters === null) return '—'
  const miles = meters / 1609.344
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`
}
