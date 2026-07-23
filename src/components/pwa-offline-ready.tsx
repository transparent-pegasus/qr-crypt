import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import type { RegisterSWOptions } from "virtual:pwa-register/react"
import { toast } from "sonner"
import { useDefaultRegisterSW } from "@/hooks/use-register-sw"

export interface RegisterSwResult {
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>]
}

export type UseRegisterSwHook = (options?: RegisterSWOptions) => RegisterSwResult

interface PwaOfflineReadyContextValue {
  offlineReady: boolean
  error: string | null
}

const PwaOfflineReadyContext = createContext<PwaOfflineReadyContextValue | null>(null)

export function usePwaOfflineReady(): PwaOfflineReadyContextValue {
  const value = useContext(PwaOfflineReadyContext)
  if (!value) {
    throw new Error("usePwaOfflineReady must be used inside PwaOfflineReady")
  }
  return value
}

export function PwaOfflineReady({
  children,
  registerHook,
}: {
  children: ReactNode
  registerHook: UseRegisterSwHook | undefined
}) {
  const [error, setError] = useState<string | null>(null)
  const [swActive, setSwActive] = useState(false)
  const registrationOptions = useMemo<RegisterSWOptions>(
    () => ({
      onRegisterError: () => {
        setError("Service Workerを登録できませんでした。")
      },
    }),
    [],
  )
  const useRegistration = registerHook ?? useDefaultRegisterSW
  const [offlineReady] = useRegistration(registrationOptions).offlineReady

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    let cancelled = false
    void navigator.serviceWorker.ready.then(() => {
      if (!cancelled) setSwActive(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (offlineReady) toast.success("オフライン利用の準備ができました")
  }, [offlineReady])

  const contextValue = useMemo(
    () => ({ offlineReady: offlineReady || swActive, error }),
    [error, offlineReady, swActive],
  )

  return (
    <PwaOfflineReadyContext.Provider value={contextValue}>
      {children}
    </PwaOfflineReadyContext.Provider>
  )
}
