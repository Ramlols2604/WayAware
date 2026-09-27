import { useState } from 'react'
import MapScreen from './MapScreen'
import PersonalInfoScreen from './PersonalInfoScreen'
import PersonalizeScreen from './PersonalizeScreen'
import SettingsScreen from './SettingsScreen'
import WelcomeScreen from './WelcomeScreen'
import {
  ROUTE_PREFERENCE_STORAGE_KEY,
  readStoredRoutePreference,
  writeStoredRoutePreference,
} from './map/routeExposure'
import type { Profile } from './profile'

type Screen = 'welcome' | 'personalize' | 'map' | 'settings' | 'personal-info'
type RoutePreference = 'safest' | 'fastest'
type ThemeChoice = 'dark' | 'light'

function loadRoutePreference(): RoutePreference {
  try {
    return readStoredRoutePreference(window.localStorage.getItem(ROUTE_PREFERENCE_STORAGE_KEY))
  } catch {
    return 'safest'
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [routePreference, setRoutePreference] = useState<RoutePreference>(loadRoutePreference)
  const [voiceAlerts, setVoiceAlerts] = useState(true)
  const [theme, setTheme] = useState<ThemeChoice>('dark')

  return (
    <div data-theme={theme} className="flex min-h-dvh w-full items-center justify-center bg-[var(--wa-stage)]">
      <div className="@container relative flex h-dvh w-full max-w-[390px] flex-col overflow-hidden bg-[var(--wa-bg)] min-[480px]:h-[min(844px,calc(100dvh-2rem))] min-[480px]:rounded-[2.5rem] min-[480px]:shadow-[0_24px_80px_rgba(0,0,0,0.55)] min-[480px]:ring-1 min-[480px]:ring-[var(--wa-ring)]">
        {screen === 'welcome' && <WelcomeScreen onGetStarted={() => setScreen('personalize')} />}
        {screen === 'personalize' && (
          <PersonalizeScreen
            onBack={() => setScreen('welcome')}
            onContinue={(nextProfile) => {
              setProfile(nextProfile)
              setScreen('map')
            }}
          />
        )}
        {(screen === 'map' || screen === 'settings' || screen === 'personal-info') && (
          <div className={screen === 'map' ? 'absolute inset-0' : 'hidden'}>
            <MapScreen
              active={screen === 'map'}
              onOpenSettings={() => setScreen('settings')}
              onBack={() => setScreen('welcome')}
              routePreference={routePreference}
            />
          </div>
        )}
        {screen === 'settings' && (
          <SettingsScreen
            routePreference={routePreference}
            onRoutePreference={(value) => {
              setRoutePreference(value)
              try {
                writeStoredRoutePreference(window.localStorage, value)
              } catch {
                // The choice still applies until the page is closed.
              }
            }}
            voiceAlerts={voiceAlerts}
            onVoiceAlerts={setVoiceAlerts}
            theme={theme}
            onTheme={setTheme}
            onBack={() => setScreen('map')}
            onPersonalInfo={() => setScreen('personal-info')}
            onSignOut={() => setScreen('welcome')}
          />
        )}
        {screen === 'personal-info' && profile && (
          <PersonalInfoScreen profile={profile} onChange={setProfile} onBack={() => setScreen('settings')} />
        )}
      </div>
    </div>
  )
}
