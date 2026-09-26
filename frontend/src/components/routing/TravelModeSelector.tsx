import type { TravelMode } from '../../types/api'

const outfit = { fontFamily: 'Outfit, sans-serif' }

type TravelModeSelectorProps = {
  mode: TravelMode
  onChange: (mode: TravelMode) => void
}

const options: { id: TravelMode; label: string }[] = [
  { id: 'walking', label: 'Walking' },
  { id: 'driving', label: 'Driving' },
]

export default function TravelModeSelector({ mode, onChange }: TravelModeSelectorProps) {
  return (
    <div className="mt-1 flex gap-1 border-t border-[var(--wa-line)] pt-2" role="radiogroup" aria-label="Travel mode">
      {options.map((option) => {
        const selected = mode === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={`flex-1 rounded-xl py-1.5 text-[0.84rem] font-semibold focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none ${
              selected ? 'bg-[#3b82f6] text-white' : 'text-[var(--wa-text-muted)]'
            }`}
            style={outfit}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
