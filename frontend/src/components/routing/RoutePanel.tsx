import type { RouteAlternative, RouteSafety } from '../../types/api'

const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

type RoutePanelProps = {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  routes: RouteAlternative[]
  selectedId: string | null
  preference: RouteSafety
  safetyRankingAvailable: boolean
  onSelect: (id: string) => void
  onRetry: () => void
}

export default function RoutePanel({
  status,
  routes,
  selectedId,
  preference,
  safetyRankingAvailable,
  onSelect,
  onRetry,
}: RoutePanelProps) {
  if (status === 'idle') return null
  const selected = routes.find((route) => route.id === selectedId) ?? routes[0]

  return (
    <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 rounded-3xl border border-[var(--wa-line)] bg-[var(--wa-card)] px-4 py-3.5 shadow-[var(--wa-sheet-shadow)]">
      {status === 'loading' && <p className="text-[0.95rem] font-semibold text-[var(--wa-text)]" style={outfit}>Finding your route…</p>}
      {status === 'empty' && <p className="text-[0.95rem] font-semibold text-[var(--wa-text)]" style={outfit}>No route available for this trip.</p>}
      {status === 'error' && (
        <button type="button" onClick={onRetry} className="text-left text-[0.95rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          Unable to load route. Try again.
        </button>
      )}
      {status === 'ready' && selected && (
        <>
          <p className="text-[1.7rem] leading-none font-bold text-[var(--wa-text)]" style={outfit}>
            {formatDuration(selected.durationSeconds)}
          </p>
          <p className="mt-1 text-[0.95rem] text-[var(--wa-text-muted)]" style={inter}>
            {formatDistance(selected.distanceMeters)}
          </p>
          {preference === 'safest' && !safetyRankingAvailable && (
            <p className="mt-2 text-[0.75rem] text-[var(--wa-text-muted)]" style={inter}>
              Safest ranking is not available from the route service yet.
            </p>
          )}
          {routes.length > 1 && (
            <div className="mt-3 flex flex-col gap-1.5" role="radiogroup" aria-label="Route alternatives">
              {routes.map((route, index) => {
                const active = route.id === selected.id
                return (
                  <button
                    key={route.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelect(route.id)}
                    className={`rounded-xl border px-3 py-2 text-left ${
                      active ? 'border-[#3b82f6] bg-[#3b82f6]/10' : 'border-[var(--wa-line)]'
                    }`}
                  >
                    <span className="block text-[0.84rem] font-semibold text-[var(--wa-text)]" style={outfit}>
                      Route {index + 1}
                    </span>
                    <span className="text-[0.8rem] text-[var(--wa-text-muted)]" style={inter}>
                      {formatDuration(route.durationSeconds)} · {formatDistance(route.distanceMeters)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
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
