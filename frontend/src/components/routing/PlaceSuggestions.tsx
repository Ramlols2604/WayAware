import type { PlaceSuggestion } from '../../types/api'
import type { SearchStatus } from '../../routing/usePlaceSearch'

const inter = { fontFamily: 'Inter, sans-serif' }

type PlaceSuggestionsProps = {
  status: SearchStatus
  suggestions: PlaceSuggestion[]
  onSelect: (suggestion: PlaceSuggestion) => void
  onRetry: () => void
}

export default function PlaceSuggestions({ status, suggestions, onSelect, onRetry }: PlaceSuggestionsProps) {
  if (status === 'idle') return null

  return (
    <div className="absolute top-[calc(100%+6px)] right-0 left-0 z-30 overflow-hidden rounded-xl border border-[var(--wa-line)] bg-[var(--wa-card)] shadow-[var(--wa-card-shadow)]">
      {status === 'loading' && <StatusText>Searching locations…</StatusText>}
      {status === 'empty' && <StatusText>No locations found.</StatusText>}
      {status === 'error' && (
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onRetry} className="block w-full px-3 py-2.5 text-left text-[0.84rem] text-[var(--wa-text-muted)]" style={inter}>
          Unable to search locations. Try again.
        </button>
      )}
      {status === 'results' && (
        <>
          <ul className="max-h-40 overflow-y-auto">
            {suggestions.map((suggestion) => (
              <li key={suggestion.mapboxId}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(suggestion)}
                  className="block w-full px-3 py-2.5 text-left hover:bg-[var(--wa-hover)] focus-visible:bg-[var(--wa-hover)] focus-visible:outline-none"
                >
                  <span className="block text-[0.9rem] font-semibold text-[var(--wa-text)]" style={{ fontFamily: 'Outfit, sans-serif' }}>
                    {suggestion.label}
                  </span>
                  {suggestion.subtitle && (
                    <span className="mt-0.5 block text-[0.78rem] text-[var(--wa-text-muted)]" style={inter}>
                      {suggestion.subtitle}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {suggestions[0]?.attribution && (
            <p className="border-t border-[var(--wa-line)] px-3 py-1.5 text-[0.68rem] text-[var(--wa-text-muted)]" style={inter}>
              {suggestions[0].attribution}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function StatusText({ children }: { children: string }) {
  return (
    <p className="px-3 py-2.5 text-[0.84rem] text-[var(--wa-text-muted)]" style={inter}>
      {children}
    </p>
  )
}
