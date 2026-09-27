import type { RouteAlternative } from '../../types/api'

const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

type RoutePanelProps = {
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  routes: RouteAlternative[]
  selectedId: string | null
  onRetry: () => void
}

export default function RoutePanel({ status, routes, selectedId, onRetry }: RoutePanelProps) {
  if (status === 'idle') return null
  const selected = routes.find((route) => route.id === selectedId) ?? routes[0]

  return (
    <div
      className="pointer-events-auto absolute inset-x-3 z-20 rounded-3xl border border-[var(--wa-line)] bg-[var(--wa-card)] px-4 py-2.5 shadow-[var(--wa-sheet-shadow)]"
      style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      {status === 'loading' && <p className="text-[0.95rem] leading-5 font-semibold text-[var(--wa-text)]" style={outfit}>Finding your route…</p>}
      {status === 'empty' && <p className="text-[0.95rem] leading-5 font-semibold text-[var(--wa-text)]" style={outfit}>No route available for this trip.</p>}
      {status === 'error' && (
        <button type="button" onClick={onRetry} className="text-left text-[0.95rem] leading-5 font-semibold text-[var(--wa-text)]" style={outfit}>
          Unable to load route. Try again.
        </button>
      )}
      {status === 'ready' && selected && (
        <p className="flex items-baseline gap-2 text-[0.95rem] leading-5 whitespace-nowrap">
          <span className="font-semibold text-[var(--wa-text)]" style={outfit}>
            {formatDuration(selected.durationSeconds)}
          </span>
          <span className="text-[var(--wa-text-muted)]" aria-hidden="true" style={inter}>
            ·
          </span>
          <span className="font-medium text-[var(--wa-text-muted)]" style={inter}>
            {formatDistance(selected.distanceMeters)}
          </span>
        </p>
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
