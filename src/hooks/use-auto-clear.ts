import { useEffect, useRef } from "react"

export interface UseAutoClearOptions {
  seconds: number
  onClear: () => void
  clearNonce?: number
  now?: () => number
}

export function useAutoClear({
  seconds,
  onClear,
  clearNonce,
  now = Date.now,
}: UseAutoClearOptions): void {
  const onClearRef = useRef(onClear)
  const nowRef = useRef(now)
  const secondsRef = useRef(seconds)
  const deadlineRef = useRef<number | null>(null)
  const hiddenAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearedRef = useRef(false)
  const initialNonceRef = useRef(clearNonce)

  useEffect(() => {
    onClearRef.current = onClear
    nowRef.current = now
    secondsRef.current = seconds
  }, [now, onClear, seconds])

  useEffect(() => {
    const cancelTimer = () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
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
      const delay = Math.max(0, secondsRef.current * 1000)
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
      if (document.visibilityState === "hidden") {
        scheduleFrom(nowRef.current())
      } else {
        handleReturn()
      }
    }

    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("pageshow", handleReturn)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("pageshow", handleReturn)
      cancelTimer()
    }
  }, [])

  useEffect(() => {
    const hiddenAt = hiddenAtRef.current
    if (hiddenAt === null || clearedRef.current) return
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    const deadline = hiddenAt + Math.max(0, seconds * 1000)
    deadlineRef.current = deadline
    const remaining = deadline - nowRef.current()
    if (remaining <= 0) {
      clearedRef.current = true
      deadlineRef.current = null
      timerRef.current = null
      onClearRef.current()
      return
    }
    timerRef.current = setTimeout(() => {
      if (clearedRef.current) return
      clearedRef.current = true
      deadlineRef.current = null
      timerRef.current = null
      onClearRef.current()
    }, remaining)
  }, [seconds])

  useEffect(() => {
    if (clearNonce === undefined || clearNonce === initialNonceRef.current) return
    initialNonceRef.current = clearNonce
    onClearRef.current()
  }, [clearNonce])
}
