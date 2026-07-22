import { useEffect, useState } from "react"
import { probeReachability } from "@/lib/reachability"

const ONLINE_PROBE_INTERVAL_MS = 4000
const OFFLINE_PROBE_INTERVAL_MS = 15_000

interface AbortableProbe extends Promise<boolean> {
  abort?: () => void
}

export function useOnlineStatus(): boolean {
  // navigator.onLine is only a startup hint. Expose `true` after the
  // reachability probe commits it so consumers cannot mistake the hint for a
  // confirmed online episode.
  const [online, setOnline] = useState(false)

  useEffect(() => {
    let active = true
    let currentOnline = false
    let intervalId: ReturnType<typeof setInterval> | undefined
    let activeProbe: AbortableProbe | null = null

    function scheduleInterval(): void {
      if (intervalId !== undefined) clearInterval(intervalId)
      intervalId = setInterval(
        () => void runProbe(),
        currentOnline ? ONLINE_PROBE_INTERVAL_MS : OFFLINE_PROBE_INTERVAL_MS,
      )
    }

    function commitStatus(nextOnline: boolean): void {
      if (!active || currentOnline === nextOnline) return
      currentOnline = nextOnline
      setOnline(nextOnline)
      scheduleInterval()
    }

    function finishProbe(probe: AbortableProbe, reachable: boolean): void {
      if (!active || activeProbe !== probe) return
      activeProbe = null
      commitStatus(reachable)
    }

    function runProbe(): void {
      if (!active || activeProbe !== null) return
      const probe = probeReachability() as AbortableProbe
      activeProbe = probe
      void probe.then(
        (reachable) => finishProbe(probe, reachable),
        () => finishProbe(probe, false),
      )
    }

    function handleOffline(): void {
      const probe = activeProbe
      activeProbe = null
      probe?.abort?.()
      commitStatus(false)
    }

    function handleOnline(): void {
      runProbe()
    }

    function handleVisibility(): void {
      if (document.visibilityState === "visible") runProbe()
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    document.addEventListener("visibilitychange", handleVisibility)
    scheduleInterval()
    queueMicrotask(runProbe)

    return () => {
      active = false
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      document.removeEventListener("visibilitychange", handleVisibility)
      if (intervalId !== undefined) clearInterval(intervalId)
      activeProbe?.abort?.()
      activeProbe = null
    }
  }, [])

  return online
}
