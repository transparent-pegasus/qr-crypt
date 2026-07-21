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
import { PwaUpdatePrompt, type UseRegisterSwHook } from "@/components/pwa-update-prompt"
import { Toaster } from "@/components/ui/sonner"

export type Theme = "light" | "dark" | "system"

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function storedTheme(): Theme {
  const value = window.localStorage.getItem("oc-theme")
  return value === "light" || value === "dark" || value === "system" ? value : "system"
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
    window.localStorage.setItem("oc-theme", nextTheme)
    setThemeState(nextTheme)
  }, [])

  useEffect(() => {
    window.localStorage.setItem("oc-theme", theme)
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
            <PwaUpdatePrompt registerHook={pwaHook}>{children}</PwaUpdatePrompt>
            <Toaster position="top-center" richColors />
          </SensitiveSessionProvider>
        </TransientClearProvider>
      </FeatureSupportProvider>
    </ThemeProvider>
  )
}
