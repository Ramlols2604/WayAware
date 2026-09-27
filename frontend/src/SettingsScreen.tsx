import type { ReactNode } from 'react'

const outfit = { fontFamily: 'Outfit, sans-serif' }
const inter = { fontFamily: 'Inter, sans-serif' }

type RoutePreference = 'safest' | 'fastest'
type ThemeChoice = 'dark' | 'light'

type SettingsScreenProps = {
  routePreference: RoutePreference
  onRoutePreference: (value: RoutePreference) => void
  voiceAlerts: boolean
  onVoiceAlerts: (value: boolean) => void
  theme: ThemeChoice
  onTheme: (value: ThemeChoice) => void
  onBack: () => void
  onPersonalInfo: () => void
  onSignOut: () => void
}

export default function SettingsScreen({
  routePreference,
  onRoutePreference,
  voiceAlerts,
  onVoiceAlerts,
  theme,
  onTheme,
  onBack,
  onPersonalInfo,
  onSignOut,
}: SettingsScreenProps) {
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--wa-bg)] px-6 pt-11 pb-6">
      <header className="relative flex h-11 shrink-0 items-center justify-center">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          data-focus-id="settings"
          className="absolute left-0 flex size-10 items-center justify-center rounded-full text-[var(--wa-text)] transition-colors hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
        >
          <BackArrow />
        </button>
        <h1 className="text-[1.15rem] font-bold text-[var(--wa-text)]" style={outfit}>
          Settings
        </h1>
      </header>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        <Section label="Route preferences">
          <div className="overflow-hidden rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-card)]">
            <div className="px-4 pt-3 pb-2.5">
              <p className="text-[1rem] font-semibold text-[var(--wa-text)]" style={outfit}>
                Default Route
              </p>
              <p className="mt-1 text-[0.84rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
                Choose which route WayAware prioritizes.
              </p>
            </div>
            <div role="radiogroup" aria-label="Default route">
              <ChoiceRow
                label="Safest Route"
                selected={routePreference === 'safest'}
                onSelect={() => onRoutePreference('safest')}
              />
              <ChoiceRow
                label="Fastest Route"
                selected={routePreference === 'fastest'}
                onSelect={() => onRoutePreference('fastest')}
              />
            </div>
          </div>
        </Section>

        <Section label="Alerts">
          <div className="flex items-center gap-4 rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-card)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[1rem] font-semibold text-[var(--wa-text)]" style={outfit}>
                Voice Alerts
              </p>
              <p className="mt-1 text-[0.84rem] leading-snug text-[var(--wa-text-muted)]" style={inter}>
                Hear spoken warnings for incidents and crime patterns ahead.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={voiceAlerts}
              aria-label="Voice Alerts"
              onClick={() => onVoiceAlerts(!voiceAlerts)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:outline-none ${
                voiceAlerts ? 'bg-[#3b82f6]' : 'bg-[var(--wa-toggle-off)]'
              }`}
            >
              <span
                className={`absolute top-0.5 size-6 rounded-full bg-white shadow-sm transition-all ${
                  voiceAlerts ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </Section>

        <Section label="Appearance">
          <div className="overflow-hidden rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-card)]">
            <p className="px-4 pt-3 text-[1rem] font-semibold text-[var(--wa-text)]" style={outfit}>
              Theme
            </p>
            <div className="mt-1" role="radiogroup" aria-label="Theme">
              <ChoiceRow label="Dark" selected={theme === 'dark'} onSelect={() => onTheme('dark')} />
              <ChoiceRow label="Light" selected={theme === 'light'} onSelect={() => onTheme('light')} />
            </div>
          </div>
        </Section>

        <Section label="Account">
          <button
            type="button"
            onClick={onPersonalInfo}
            data-focus-id="settings-personal"
            className="flex w-full items-center gap-3 rounded-2xl border border-[var(--wa-border)] bg-[var(--wa-card)] px-4 py-3 text-left transition-colors hover:bg-[var(--wa-hover)] focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:outline-none"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-[var(--wa-icon-bg)] text-[var(--wa-text-muted)]">
              <ProfileIcon />
            </span>
            <span className="flex-1 text-[1rem] font-semibold text-[var(--wa-text)]" style={outfit}>
              Personal Information
            </span>
            <Chevron />
          </button>
        </Section>

        <button
          type="button"
          onClick={onSignOut}
          className="mt-6 px-1 py-2 text-[1rem] font-semibold text-[#e07070] focus-visible:ring-2 focus-visible:ring-[#e07070] focus-visible:outline-none"
          style={outfit}
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h2 className="mb-2 px-1 text-[0.72rem] font-semibold tracking-[0.16em] text-[var(--wa-label)] uppercase" style={outfit}>
        {label}
      </h2>
      {children}
    </section>
  )
}

function ChoiceRow({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center justify-between border-t border-[var(--wa-border)] px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6] focus-visible:outline-none ${
        selected ? 'bg-[#3b82f6]/10' : ''
      }`}
    >
      <span className="text-[0.98rem] font-semibold text-[var(--wa-text)]" style={outfit}>
        {label}
      </span>
      <span
        className={`flex size-5 items-center justify-center rounded-full border ${
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

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.2 14.2v-.6c0-2 2-3.4 4.8-3.4s4.8 1.4 4.8 3.4v.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-[var(--wa-text-muted)]">
      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
