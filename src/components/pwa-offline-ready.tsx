import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import type { RegisterSWOptions } from "virtual:pwa-register/react"
import { toast } from "sonner"
import { useDefaultRegisterSW } from "@/hooks/use-register-sw"
import { useI18n, type MessageKey } from "@/i18n"

export interface RegisterSwResult {
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>]
}

export type UseRegisterSwHook = (options?: RegisterSWOptions) => RegisterSwResult

interface PwaOfflineReadyContextValue {
  offlineReady: boolean
  error: MessageKey | null
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
  const { t } = useI18n()
  const [error, setError] = useState<MessageKey | null>(null)
  const [swControlling, setSwControlling] = useState(
    () => "serviceWorker" in navigator && navigator.serviceWorker.controller !== null,
  )
  const announcedOfflineReady = useRef(false)
  const registrationOptions = useMemo<RegisterSWOptions>(
    () => ({
      onRegisterError: () => {
        setError("pwa.registerError")
      },
    }),
    [],
  )
  const useRegistration = registerHook ?? useDefaultRegisterSW
  const [offlineReady] = useRegistration(registrationOptions).offlineReady

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const container = navigator.serviceWorker
    const onControllerChange = () => setSwControlling(container.controller !== null)
    container.addEventListener("controllerchange", onControllerChange)
    return () => container.removeEventListener("controllerchange", onControllerChange)
  }, [])

  const announceReady = offlineReady && swControlling

  useEffect(() => {
    if (announceReady && !announcedOfflineReady.current) {
      toast.success(t("pwa.offlineReady.toast"))
    }
    announcedOfflineReady.current = announceReady
  }, [announceReady, t])

  const contextValue = useMemo(
    () => ({ offlineReady: swControlling, error }),
    [error, swControlling],
  )

  return (
    <PwaOfflineReadyContext.Provider value={contextValue}>
      {children}
    </PwaOfflineReadyContext.Provider>
  )
}
