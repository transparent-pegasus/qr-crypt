import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  MAINTENANCE_TOKEN_BROADCAST_CHANNEL,
  MAINTENANCE_TOKEN_CHANGED_EVENT,
  readBootDecision,
  type BootDecisionSnapshot,
} from "@/app/boot/boot-controller"
import {
  MaintenanceTokenContext,
  type MaintenanceTokenState,
} from "@/hooks/use-maintenance-token"

export function MaintenanceTokenProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<MaintenanceTokenState>({
    armed: null,
    readFailed: false,
  })
  const generation = useRef(0)
  const active = useRef(false)

  const refresh = useCallback(async () => {
    if (!active.current) return
    const request = ++generation.current
    let decision: BootDecisionSnapshot | undefined
    try {
      decision = await readBootDecision()
    } catch {
      // A rejected read and boot's indeterminate fallback are both unknown.
    }
    if (request !== generation.current) return
    setToken((previous) =>
      decision && decision.cleanOrigin !== "indeterminate"
        ? { armed: decision.maintenanceTokenArmed, readFailed: false }
        : { armed: previous.armed === true ? true : null, readFailed: true },
    )
  }, [])

  useEffect(() => {
    active.current = true
    const invalidate = () => {
      void refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") invalidate()
    }
    const onPeerMessage = (event: MessageEvent<unknown>) => {
      const message = event.data
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "changed"
      )
        invalidate()
    }
    window.addEventListener(MAINTENANCE_TOKEN_CHANGED_EVENT, invalidate)
    window.addEventListener("focus", invalidate)
    document.addEventListener("visibilitychange", onVisibility)
    let channel: BroadcastChannel | undefined
    try {
      channel = new BroadcastChannel(MAINTENANCE_TOKEN_BROADCAST_CHANNEL)
      channel.addEventListener("message", onPeerMessage)
    } catch {
      // Without peer messaging, the next focus/visibility change catches up.
    }
    invalidate()
    return () => {
      active.current = false
      generation.current += 1
      window.removeEventListener(MAINTENANCE_TOKEN_CHANGED_EVENT, invalidate)
      window.removeEventListener("focus", invalidate)
      document.removeEventListener("visibilitychange", onVisibility)
      channel?.close()
    }
  }, [refresh])

  return (
    <MaintenanceTokenContext.Provider value={{ ...token, refresh }}>
      {children}
    </MaintenanceTokenContext.Provider>
  )
}
