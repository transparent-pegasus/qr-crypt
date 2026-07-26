import { useEffect, useRef } from "react"
import { probeWebAssemblyRuntime } from "@/lib/feature-detect"
import { env } from "@/schemas/env-schema"

export interface UseAutoClearOptions {
  enabled: boolean
  onClear: () => void
  clearNonce?: number
  now?: () => number
}

export function useAutoClear({
  enabled,
  onClear,
  clearNonce,
  now = Date.now,
}: UseAutoClearOptions): void {
  const onClearRef = useRef(onClear)
  const nowRef = useRef(now)
  const deadlineRef = useRef<number | null>(null)
  const hiddenAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearedRef = useRef(false)
  const initialNonceRef = useRef(clearNonce)
  const delaySecondsRef = useRef(env.autoClearSeconds)

  useEffect(() => {
    onClearRef.current = onClear
    nowRef.current = now
  }, [now, onClear])

  useEffect(() => {
    let active = true
    void probeWebAssemblyRuntime().then((available) => {
      if (!active) return
      // Update future schedules only; a pending deadline is never extended after probing.
      delaySecondsRef.current = available
        ? env.autoClearSeconds
        : env.autoClearFallbackSeconds
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const cancelTimer = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
    }

    const resetDeadline = () => {
      cancelTimer()
      deadlineRef.current = null
      hiddenAtRef.current = null
      clearedRef.current = false
    }

    if (!enabled) {
      resetDeadline()
      return
    }

    const clearOnce = () => {
      if (clearedRef.current) return
      clearedRef.current = true
      deadlineRef.current = null
      cancelTimer()
      onClearRef.current()
    }

    const scheduleFrom = (hiddenAt: number) => {
      cancelTimer()
      clearedRef.current = false
      hiddenAtRef.current = hiddenAt
      const delay = Math.max(0, delaySecondsRef.current * 1000)
      deadlineRef.current = hiddenAt + delay
      if (delay === 0 || nowRef.current() >= deadlineRef.current) {
        clearOnce()
        return
      }
      timerRef.current = setTimeout(clearOnce, delay)
    }

    const handleReturn = () => {
      const deadline = deadlineRef.current
      if (deadline !== null && nowRef.current() >= deadline) clearOnce()
      cancelTimer()
      deadlineRef.current = null
      hiddenAtRef.current = null
    }

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") scheduleFrom(nowRef.current())
      else handleReturn()
    }

    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("pageshow", handleReturn)
    if (document.visibilityState === "hidden") scheduleFrom(nowRef.current())

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("pageshow", handleReturn)
      resetDeadline()
    }
  }, [enabled])

  useEffect(() => {
    if (clearNonce === undefined || clearNonce === initialNonceRef.current) return
    initialNonceRef.current = clearNonce
    onClearRef.current()
  }, [clearNonce])
}
