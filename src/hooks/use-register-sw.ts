import { useEffect, useRef, useState } from "react"

export interface RegisterSwOptions {
  onRegisterError: (error: unknown) => void
}

export interface RegisterSwResult {
  offlineReady: boolean
}

export function useDefaultRegisterSW(options: RegisterSwOptions): RegisterSwResult {
  const [offlineReady, setOfflineReady] = useState(false)
  const onRegisterError = useRef(options.onRegisterError)

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
    let mounted = true
    let worker: ServiceWorker | null = null
    const updateReady = () => {
      if (
        mounted &&
        worker &&
        ["installed", "activating", "activated"].includes(worker.state)
      ) {
        setOfflineReady(true)
      }
    }
    const register = async () => {
      const existing = await navigator.serviceWorker.getRegistration("/")
      if (!mounted) return
      const firstInstall = !existing?.active
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      })
      if (!mounted || !firstInstall) return
      worker = registration.installing ?? registration.waiting ?? registration.active
      worker?.addEventListener("statechange", updateReady)
      updateReady()
    }
    void register().catch((error: unknown) => {
      if (mounted) onRegisterError.current(error)
    })
    return () => {
      mounted = false
      worker?.removeEventListener("statechange", updateReady)
    }
  }, [])

  return { offlineReady }
}
