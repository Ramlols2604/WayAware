import { useState } from 'react'
import { ageOptions, genderOptions, travelOptions, type AgeGroup, type Gender, type Profile, type TravelMode } from './profile'

type PersonalizeScreenProps = {
  onBack: () => void
  onContinue: (profile: Profile) => void
}

const ages = ageOptions
const genders = genderOptions
const travelModes = travelOptions

const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

export default function PersonalizeScreen({ onBack, onContinue }: PersonalizeScreenProps) {
  const [age, setAge] = useState<AgeGroup | null>(null)
  const [gender, setGender] = useState<Gender | null>(null)
  const [travel, setTravel] = useState<TravelMode[]>([])

  const ready = age !== null && gender !== null && travel.length > 0

  function toggleTravel(id: TravelMode) {
    setTravel((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--wa-bg)] px-6 pt-10 pb-5">
      <header className="relative flex h-11 shrink-0 items-center justify-center">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          data-focus-id="personalize"
          className="absolute left-0 flex size-10 items-center justify-center rounded-full text-[var(--wa-text)] transition-colors hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
        >
          <BackArrow />
        </button>
        <p className="text-[1.35rem] leading-none font-black tracking-[-0.03em] text-[var(--wa-text)]" style={outfit}>
          Way<span className="text-[#3b82f6]">Aware</span>
        </p>
      </header>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <h1 className="text-[1.65rem] leading-tight font-bold tracking-[-0.02em] text-[var(--wa-text)]" style={outfit}>
          Tell us about yourself
        </h1>
        <p className="mt-1.5 text-[0.95rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
          Help us personalize your WayAware experience.
        </p>

        <section className="mt-4" aria-labelledby="age-label">
          <h2 id="age-label" className="text-[0.95rem] font-semibold text-[var(--wa-text)]" style={outfit}>
            What is your age group?
          </h2>
          <div className="mt-2.5 grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="age-label">
            {ages.map((option) => {
              const selected = age === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAge(option.id)}
                  className={`relative rounded-2xl border px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:outline-none ${
                    selected ? 'border-[#3b82f6] bg-[#3b82f6] text-white' : 'border-[var(--wa-option-border)] bg-[var(--wa-card)] text-[var(--wa-text)]'
                  }`}
                >
                  <span className="block text-[0.95rem] font-semibold" style={outfit}>
                    {option.label}
                  </span>
                  <span
                    className={`mt-0.5 block text-[0.8rem] ${selected ? 'text-white' : 'text-[var(--wa-text-muted)]'}`}
                    style={inter}
                  >
                    {option.range}
                  </span>
                  {selected && (
                    <span className="absolute top-2.5 right-2.5">
                      <CheckMark />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        <section className="mt-4" aria-labelledby="gender-label">
          <h2 id="gender-label" className="text-[0.95rem] font-semibold text-[var(--wa-text)]" style={outfit}>
            Gender
          </h2>
          <div className="mt-2.5 grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="gender-label">
            {genders.map((option) => {
              const selected = gender === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setGender(option.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-2xl border px-2 py-3 text-[0.95rem] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:outline-none ${
                    selected ? 'border-[#3b82f6] bg-[#3b82f6] text-white' : 'border-[var(--wa-option-border)] bg-[var(--wa-card)] text-[var(--wa-text)]'
                  }`}
                  style={outfit}
                >
                  {option.label}
                  {selected && <CheckMark />}
                </button>
              )
            })}
          </div>
        </section>

        <section className="mt-4" aria-labelledby="travel-label">
          <h2 id="travel-label" className="text-[0.95rem] font-semibold text-[var(--wa-text)]" style={outfit}>
            How do you travel?
          </h2>
          <p className="mt-1 text-[0.8rem] text-[var(--wa-text-muted)]" style={inter}>
            Select all that apply
          </p>
          <div className="mt-2.5 flex flex-col gap-2">
            {travelModes.map((option) => {
              const selected = travel.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggleTravel(option.id)}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--wa-option-border)] bg-[var(--wa-card)] px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:outline-none"
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-[6px] border ${
                      selected ? 'border-[#3b82f6] bg-[#3b82f6]' : 'border-[var(--wa-control)] bg-[var(--wa-checkbox-bg)]'
                    }`}
                    aria-hidden="true"
                  >
                    {selected && <CheckMark />}
                  </span>
                  <TravelIcon name={option.icon} />
                  <span className="text-[0.95rem] font-semibold text-[var(--wa-text)]" style={outfit}>
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      <button
        type="button"
        disabled={!ready}
        onClick={() => {
          if (!age || !gender) return
          onContinue({ age, gender, travel })
        }}
        className={`mt-3 w-full shrink-0 rounded-2xl py-[17px] text-[1.05rem] font-bold tracking-wide transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--wa-bg)] focus-visible:outline-none ${
          ready ? 'text-white active:scale-[0.97]' : 'cursor-not-allowed text-[var(--wa-disabled-text)]'
        }`}
        style={
          ready
            ? {
                ...outfit,
                background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 60%, #60a5fa 100%)',
                boxShadow: '0 4px 32px rgba(59,130,246,0.45), 0 1px 6px rgba(0,0,0,0.4)',
              }
            : {
                ...outfit,
                background: 'var(--wa-disabled-bg)',
              }
        }
      >
        Continue
      </button>
    </div>
  )
}

function BackArrow() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M13.5 5.5L8 11l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.2 6.2L4.7 8.7 9.8 3.4" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TravelIcon({ name }: { name: 'walking' | 'bike' | 'car' | 'transit' }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    'aria-hidden': true as const,
    className: 'shrink-0 text-[var(--wa-text-muted)]',
  }

  if (name === 'walking') {
    return (
      <svg {...common}>
        <circle cx="11" cy="3.2" r="1.4" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8.2 8.2l2-2.2 1.6 1.2 1.5 2.4M10.2 7.2L8.4 12.2l2.3.4M8.4 12.2L7 16.4M10.7 12.6l1.6 3.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (name === 'bike') {
    return (
      <svg {...common}>
        <circle cx="5" cy="14" r="2.6" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="15" cy="14" r="2.6" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M5 14l3.2-6.2h2.4M8.2 7.8L12 14M10.6 7.8h3.2L15 14M12.2 5.2h2.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (name === 'car') {
    return (
      <svg {...common}>
        <path
          d="M3.2 12.2l1.2-3.6A1.6 1.6 0 0 1 5.9 7.4h8.2a1.6 1.6 0 0 1 1.5 1.2l1.2 3.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M3 12.2h14v2.4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.4z" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6.2" cy="15.6" r="1.1" fill="currentColor" />
        <circle cx="13.8" cy="15.6" r="1.1" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <rect x="2.5" y="5" width="15" height="9.2" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 9.2h15M6.2 5v4.2M10 5v4.2M13.8 5v4.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.2 16.4v-2.2M14.8 16.4v-2.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
