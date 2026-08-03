import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type { FeatureSupport } from "@/lib/feature-detect"
import { DisplayGateProvider } from "@/app/display-gate"
import { PwaOfflineReady, type UseRegisterSwHook } from "@/components/pwa-offline-ready"
import { Toaster } from "@/components/ui/sonner"
import { OC_LOCAL_STORAGE_CLEARED_EVENT } from "@/storage/reset-events"

export type Theme = "light" | "dark" | "system"

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export const THEME_STORAGE_KEY = "oc-theme"

function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return value === "light" || value === "dark" || value === "system" ? value : "system"
  } catch {
    return "system"
  }
}

function applyTheme(theme: Theme, prefersDark: boolean): void {
  const useDark = theme === "dark" || (theme === "system" && prefersDark)
  if (useDark) {
    document.documentElement.classList.add("dark")
  } else {
    document.documentElement.classList.remove("dark")
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(storedTheme)

  const setTheme = useCallback((nextTheme: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // Theme persistence is best-effort; rendering must survive denied storage.
    }
    setThemeState(nextTheme)
  }, [])

  useEffect(() => {
    const resetToSystem = () => setThemeState("system")
    const handlePeerStorageReset = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && event.newValue === null) {
        resetToSystem()
      }
    }

    window.addEventListener(OC_LOCAL_STORAGE_CLEARED_EVENT, resetToSystem)
    window.addEventListener("storage", handlePeerStorageReset)
    return () => {
      window.removeEventListener(OC_LOCAL_STORAGE_CLEARED_EVENT, resetToSystem)
      window.removeEventListener("storage", handlePeerStorageReset)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Keep the in-memory theme when persistence is unavailable.
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const syncTheme = () => applyTheme(theme, media.matches)
    syncTheme()
    if (theme === "system") media.addEventListener("change", syncTheme)
    return () => media.removeEventListener("change", syncTheme)
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error("useTheme must be used inside ThemeProvider")
  return value
}

interface TransientClearContextValue {
  nonce: number
  clearTransient: () => void
}

const TransientClearContext = createContext<TransientClearContextValue | null>(null)

export function TransientClearProvider({ children }: { children: ReactNode }) {
  const [nonce, setNonce] = useState(0)
  const clearTransient = useCallback(() => setNonce((value) => value + 1), [])
  const value = useMemo(() => ({ nonce, clearTransient }), [clearTransient, nonce])
  return (
    <TransientClearContext.Provider value={value}>
      {children}
    </TransientClearContext.Provider>
  )
}

export function useTransientClear(): TransientClearContextValue {
  const value = useContext(TransientClearContext)
  if (!value) {
    throw new Error("useTransientClear must be used inside TransientClearProvider")
  }
  return value
}

function DisplayGateLayer({ children }: { children: ReactNode }) {
  const { clearTransient } = useTransientClear()
  return (
    <DisplayGateProvider clearTransient={clearTransient}>{children}</DisplayGateProvider>
  )
}

export interface SensitiveSessionState {
  hasPlaintext: boolean
  hasDecrypted: boolean
  cryptoBusy: boolean
  secretVisible: boolean
}

interface SensitiveSessionContextValue extends SensitiveSessionState {
  setSensitiveSession: (patch: Partial<SensitiveSessionState>) => void
  resetSensitiveSession: () => void
}

const EMPTY_SENSITIVE_SESSION: SensitiveSessionState = {
  hasPlaintext: false,
  hasDecrypted: false,
  cryptoBusy: false,
  secretVisible: false,
}

const SensitiveSessionContext = createContext<SensitiveSessionContextValue | null>(null)

export function SensitiveSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SensitiveSessionState>(EMPTY_SENSITIVE_SESSION)
  const setSensitiveSession = useCallback((patch: Partial<SensitiveSessionState>) => {
    setState((current) => {
      const next = { ...current, ...patch }
      return next.hasPlaintext === current.hasPlaintext &&
        next.hasDecrypted === current.hasDecrypted &&
        next.cryptoBusy === current.cryptoBusy &&
        next.secretVisible === current.secretVisible
        ? current
        : next
    })
  }, [])
  const resetSensitiveSession = useCallback(() => setState(EMPTY_SENSITIVE_SESSION), [])
  const value = useMemo(
    () => ({ ...state, setSensitiveSession, resetSensitiveSession }),
    [resetSensitiveSession, setSensitiveSession, state],
  )
  return (
    <SensitiveSessionContext.Provider value={value}>
      {children}
    </SensitiveSessionContext.Provider>
  )
}

export function useSensitiveSession(): SensitiveSessionContextValue {
  const value = useContext(SensitiveSessionContext)
  if (!value) {
    throw new Error("useSensitiveSession must be used inside SensitiveSessionProvider")
  }
  return value
}

const FeatureSupportContext = createContext<FeatureSupport | null>(null)

export function FeatureSupportProvider({
  children,
  features,
}: {
  children: ReactNode
  features: FeatureSupport
}) {
  return (
    <FeatureSupportContext.Provider value={features}>
      {children}
    </FeatureSupportContext.Provider>
  )
}

export function useFeatureSupport(): FeatureSupport {
  const value = useContext(FeatureSupportContext)
  if (!value) {
    throw new Error("useFeatureSupport must be used inside FeatureSupportProvider")
  }
  return value
}

export function AppProviders({
  children,
  features,
  pwaHook,
}: {
  children: ReactNode
  features: FeatureSupport
  pwaHook: UseRegisterSwHook | undefined
}) {
  return (
    <ThemeProvider>
      <FeatureSupportProvider features={features}>
        <TransientClearProvider>
          <SensitiveSessionProvider>
            <DisplayGateLayer>
              <PwaOfflineReady registerHook={pwaHook}>{children}</PwaOfflineReady>
              <Toaster
                position="bottom-center"
                richColors
                // Leave 1rem above the bottom navigation (h-16 + safe area) without overlapping it.
                offset={{ bottom: "calc(4rem + env(safe-area-inset-bottom) + 1rem)" }}
                mobileOffset={{
                  bottom: "calc(4rem + env(safe-area-inset-bottom) + 1rem)",
                }}
              />
            </DisplayGateLayer>
          </SensitiveSessionProvider>
        </TransientClearProvider>
      </FeatureSupportProvider>
    </ThemeProvider>
  )
}
