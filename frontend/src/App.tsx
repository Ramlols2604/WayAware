import { useEffect, useState, type ReactNode } from 'react'
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

const SCREEN_MS = 200

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function useMounted(open: boolean) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : SCREEN_MS)
    return () => window.clearTimeout(timer)
  }, [open])
  return open || mounted
}

function useShown(open: boolean) {
  const [shown, setShown] = useState(open)
  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    if (prefersReducedMotion()) {
      setShown(true)
      return
    }
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [open])
  if (!open || prefersReducedMotion()) return open
  return shown
}

function screenClass(shown: boolean, shift: boolean) {
  const motion = shown ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
  const slide = shift ? (shown ? 'translate-y-0' : 'translate-y-1') : ''
  return `absolute inset-0 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${motion} ${slide}`
}

function ScreenFrame({
  shown,
  active,
  shift = true,
  children,
}: {
  shown: boolean
  active: boolean
  shift?: boolean
  children: ReactNode
}) {
  return (
    <div className={screenClass(shown, shift)} inert={active ? undefined : true} aria-hidden={active ? undefined : true}>
      {children}
    </div>
  )
}

function loadRoutePreference(): RoutePreference {
  try {
    return readStoredRoutePreference(window.localStorage.getItem(ROUTE_PREFERENCE_STORAGE_KEY))
  } catch {
    return 'safest'
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [focusId, setFocusId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [routePreference, setRoutePreference] = useState<RoutePreference>(loadRoutePreference)
  const [voiceAlerts, setVoiceAlerts] = useState(true)
  const [theme, setTheme] = useState<ThemeChoice>('dark')
  const mapFlow = screen === 'map' || screen === 'settings' || screen === 'personal-info'
  const welcomeMounted = useMounted(screen === 'welcome')
  const personalizeMounted = useMounted(screen === 'personalize')
  const settingsMounted = useMounted(screen === 'settings' || screen === 'personal-info')
  const personalMounted = useMounted(screen === 'personal-info')
  const mapMounted = useMounted(mapFlow)
  const welcomeShown = useShown(screen === 'welcome')
  const personalizeShown = useShown(screen === 'personalize')
  const settingsShown = useShown(screen === 'settings')
  const personalShown = useShown(screen === 'personal-info')
  const mapShown = useShown(screen === 'map')

  useEffect(() => {
    if (!focusId) return
    const node = document.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`)
    if (!node || node.closest('[inert]')) return
    node.focus()
  }, [focusId, screen, welcomeShown, personalizeShown, settingsShown, personalShown, mapShown])

  function openScreen(next: Screen, focus: string | null) {
    setFocusId(focus)
    setScreen(next)
  }

  return (
    <div data-theme={theme} className="flex min-h-dvh w-full items-center justify-center bg-[var(--wa-stage)]">
      <div className="@container relative flex h-dvh w-full max-w-[390px] flex-col overflow-hidden bg-[var(--wa-bg)] min-[480px]:h-[min(844px,calc(100dvh-2rem))] min-[480px]:rounded-[2.5rem] min-[480px]:shadow-[0_24px_80px_rgba(0,0,0,0.55)] min-[480px]:ring-1 min-[480px]:ring-[var(--wa-ring)]">
        {welcomeMounted && (
          <ScreenFrame shown={welcomeShown} active={screen === 'welcome'}>
            <WelcomeScreen onGetStarted={() => openScreen('personalize', 'personalize')} />
          </ScreenFrame>
        )}
        {personalizeMounted && (
          <ScreenFrame shown={personalizeShown} active={screen === 'personalize'}>
            <PersonalizeScreen
              onBack={() => openScreen('welcome', 'welcome')}
              onContinue={(nextProfile) => {
                setProfile(nextProfile)
                openScreen('map', null)
              }}
            />
          </ScreenFrame>
        )}
        {mapMounted && (
          <ScreenFrame shown={mapShown} active={screen === 'map'} shift={false}>
            <MapScreen
              active={screen === 'map'}
              onOpenSettings={() => openScreen('settings', 'settings')}
              onBack={() => openScreen('welcome', 'welcome')}
              routePreference={routePreference}
            />
          </ScreenFrame>
        )}
        {settingsMounted && (
          <ScreenFrame shown={settingsShown} active={screen === 'settings'}>
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
              onBack={() => openScreen('map', 'map-gear')}
              onPersonalInfo={() => openScreen('personal-info', 'personal-info')}
              onSignOut={() => openScreen('welcome', 'welcome')}
            />
          </ScreenFrame>
        )}
        {personalMounted && profile && (
          <ScreenFrame shown={personalShown} active={screen === 'personal-info'}>
            <PersonalInfoScreen profile={profile} onChange={setProfile} onBack={() => openScreen('settings', 'settings-personal')} />
          </ScreenFrame>
        )}
      </div>
    </div>
  )
}
