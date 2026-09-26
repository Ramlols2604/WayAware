import { ageOptions, genderOptions, travelOptions, type Profile, type TravelMode } from './profile'

const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

type PersonalInfoScreenProps = {
  profile: Profile
  onChange: (profile: Profile) => void
  onBack: () => void
}

export default function PersonalInfoScreen({ profile, onChange, onBack }: PersonalInfoScreenProps) {
  function toggleTravel(id: TravelMode) {
    const travel = profile.travel.includes(id) ? profile.travel.filter((item) => item !== id) : [...profile.travel, id]
    onChange({ ...profile, travel })
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--wa-bg)] px-6 pt-12 pb-8">
      <header className="relative flex h-11 shrink-0 items-center justify-center">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="absolute left-0 flex size-10 items-center justify-center rounded-full text-[var(--wa-text)] transition-colors hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
        >
          <BackArrow />
        </button>
        <h1 className="text-[1.05rem] font-bold text-[var(--wa-text)]" style={outfit}>
          Personal Information
        </h1>
      </header>

      <div className="mt-6 min-h-0 flex-1 space-y-6 overflow-y-auto">
        <section>
          <h2 className="mb-2 px-1 text-[0.72rem] font-semibold tracking-[0.16em] text-[var(--wa-label)] uppercase" style={outfit}>
            Age Group
          </h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-card)]" role="radiogroup" aria-label="Age group">
            {ageOptions.map((option) => (
              <ChoiceRow
                key={option.id}
                label={option.label}
                detail={option.range}
                selected={profile.age === option.id}
                onSelect={() => onChange({ ...profile, age: option.id })}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[0.72rem] font-semibold tracking-[0.16em] text-[var(--wa-label)] uppercase" style={outfit}>
            Gender
          </h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-card)]" role="radiogroup" aria-label="Gender">
            {genderOptions.map((option) => (
              <ChoiceRow
                key={option.id}
                label={option.label}
                selected={profile.gender === option.id}
                onSelect={() => onChange({ ...profile, gender: option.id })}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-[0.72rem] font-semibold tracking-[0.16em] text-[var(--wa-label)] uppercase" style={outfit}>
            Travel Methods
          </h2>
          <p className="mb-2 px-1 text-[0.84rem] text-[var(--wa-text-muted)]" style={inter}>
            Select all that apply
          </p>
          <div className="overflow-hidden rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-card)]">
            {travelOptions.map((option) => {
              const selected = profile.travel.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggleTravel(option.id)}
                  className="flex w-full items-center justify-between border-t border-[var(--wa-border)] px-4 py-3.5 text-left first:border-t-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] focus-visible:outline-none"
                >
                  <span className="text-[0.98rem] font-semibold text-[var(--wa-text)]" style={outfit}>
                    {option.label}
                  </span>
                  <span
                    className={`flex size-5 items-center justify-center rounded-md border ${
                      selected ? 'border-[#3b82f6] bg-[#3b82f6]' : 'border-[var(--wa-control)]'
                    }`}
                  >
                    {selected && <CheckMark />}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function ChoiceRow({
  label,
  detail,
  selected,
  onSelect,
}: {
  label: string
  detail?: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center justify-between border-t border-[var(--wa-border)] px-4 py-3.5 text-left first:border-t-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] focus-visible:outline-none ${
        selected ? 'bg-[#3b82f6]/10' : ''
      }`}
    >
      <span>
        <span className="block text-[0.98rem] font-semibold text-[var(--wa-text)]" style={outfit}>
          {label}
        </span>
        {detail && (
          <span className="mt-0.5 block text-[0.8rem] text-[var(--wa-text-muted)]" style={inter}>
            {detail}
          </span>
        )}
      </span>
      <span
        className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
          selected ? 'border-[#3b82f6] bg-[#3b82f6]' : 'border-[var(--wa-control)]'
        }`}
      >
        {selected && <CheckMark />}
      </span>
    </button>
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
      <path d="M2.2 6.2 4.7 8.7 9.8 3.4" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
