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
    let registration: ServiceWorkerRegistration | null = null
    const updateReady = () => {
      if (
        mounted &&
        worker &&
        ["installed", "activating", "activated"].includes(worker.state)
      ) {
        setOfflineReady(true)
      }
    }
    const observeWorker = (nextWorker: ServiceWorker | null) => {
      worker = nextWorker
      worker?.addEventListener("statechange", updateReady)
      updateReady()
    }
    const onUpdateFound = () => observeWorker(registration?.installing ?? null)
    const register = async () => {
      const existing = await navigator.serviceWorker.getRegistration("/")
      if (!mounted) return
      const firstInstall = !existing?.active
      registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      })
      if (!mounted || !firstInstall) return
      observeWorker(
        registration.installing ?? registration.waiting ?? registration.active,
      )
      if (!worker) {
        registration.addEventListener("updatefound", onUpdateFound, { once: true })
      }
    }
    void register().catch((error: unknown) => {
      if (mounted) onRegisterError.current(error)
    })
    return () => {
      mounted = false
      registration?.removeEventListener("updatefound", onUpdateFound)
      worker?.removeEventListener("statechange", updateReady)
    }
  }, [])

  return { offlineReady }
}
