import { useCallback, useEffect, useRef, useState } from "react"
import { toAppError, type ErrorCode } from "@/crypto/errors"
import {
  COMPATIBLE_GENERATED_DISPLAY_PAIR,
  DEFAULT_GENERATED_DISPLAY_PAIR,
  type Preferences,
} from "@/schemas/domain"

export interface CompatibilityMode {
  updating: boolean
  error: ErrorCode | null
  change(enabled: boolean): Promise<void>
  reset(): void
}

// The preference write always finishes, but a surface that closes or supersedes
// itself must not receive the eventual UI result. Both lifecycle and imperative
// resets advance the same generation so stale completions stay silent.
export function useCompatibilityMode({
  updatePreferences,
  active,
}: {
  updatePreferences: (patch: Partial<Preferences>) => Promise<unknown>
  active: boolean
}): CompatibilityMode {
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<ErrorCode | null>(null)
  const generationRef = useRef(0)
  const activeRef = useRef(active)

  const reset = useCallback(() => {
    generationRef.current += 1
    setUpdating(false)
    setError(null)
  }, [])

  useEffect(() => {
    activeRef.current = active
    if (active) return
    // This is the synchronous projection of an inactive compatibility surface.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reset()
  }, [active, reset])

  const change = useCallback(
    async (enabled: boolean) => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      setUpdating(true)
      setError(null)
      const pair = enabled
        ? COMPATIBLE_GENERATED_DISPLAY_PAIR
        : DEFAULT_GENERATED_DISPLAY_PAIR
      try {
        await updatePreferences({
          frameBytes: pair.frameBytes,
          frameIntervalMs: pair.frameIntervalMs,
        })
      } catch (caught) {
        if (!activeRef.current || generationRef.current !== generation) return
        setError(toAppError(caught, "STORAGE_FAILED").code)
      } finally {
        if (activeRef.current && generationRef.current === generation) {
          setUpdating(false)
        }
      }
    },
    [updatePreferences],
  )

  return { updating, error, change, reset }
}
