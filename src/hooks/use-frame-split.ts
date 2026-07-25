import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { toAppError, type ErrorCode } from "@/crypto/errors"
import { splitIntoFrames } from "@/qr/multipart/split"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"

export interface UseFrameSplitArgs {
  bytes: Uint8Array
  artifactType: V2ArtifactType
  frameBytes: number
  enabled: boolean
  generation: number | string
}

export interface UseFrameSplitResult {
  frames: readonly QrFrameV2[]
  splitting: boolean
  error: ErrorCode | null
}

interface FrameSplitState extends UseFrameSplitResult {
  generation: number | string
}

export function useFrameSplit({
  bytes,
  artifactType,
  frameBytes,
  enabled,
  generation,
}: UseFrameSplitArgs): UseFrameSplitResult {
  const [state, setState] = useState<FrameSplitState>({
    generation,
    frames: [],
    splitting: false,
    error: null,
  })
  const mountedRef = useRef(true)
  const requestRef = useRef(0)
  const sessionRef = useRef(generation)
  const enabledRef = useRef(enabled)

  // Invalidate the previous session during commit, before queued promise
  // continuations can publish into a closed or superseded view.
  useLayoutEffect(() => {
    sessionRef.current = generation
    enabledRef.current = enabled
  }, [enabled, generation])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current += 1
    }
  }, [])

  useEffect(() => {
    const request = requestRef.current + 1
    requestRef.current = request
    let active = true

    if (!enabled) {
      // This state is the synchronous projection of the disabled async session.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((current) =>
        current.generation === generation
          ? { ...current, splitting: false }
          : {
              generation,
              frames: [],
              splitting: false,
              error: null,
            },
      )
      return () => {
        active = false
        if (requestRef.current === request) requestRef.current += 1
      }
    }

    const canCommit = () =>
      active &&
      mountedRef.current &&
      enabledRef.current &&
      requestRef.current === request &&
      sessionRef.current === generation

    // Starting an external split request and publishing its pending state are
    // one transition; deferring this update makes `splitting` observably stale.
    setState((current) =>
      current.generation === generation
        ? { ...current, splitting: true, error: null }
        : {
            generation,
            frames: [],
            splitting: true,
            error: null,
          },
    )

    void splitIntoFrames({
      artifactType,
      artifactBytes: bytes,
      frameBytes,
    })
      .then((frames) => {
        if (!canCommit()) return
        setState({
          generation,
          frames,
          splitting: true,
          error: null,
        })
      })
      .catch((caught: unknown) => {
        if (!canCommit()) return
        setState((current) => ({
          generation,
          frames: current.generation === generation ? current.frames : [],
          splitting: true,
          error: toAppError(caught, "QR_TOO_LARGE").code,
        }))
      })
      .finally(() => {
        if (!canCommit()) return
        setState((current) => ({
          ...current,
          splitting: false,
        }))
      })

    return () => {
      active = false
      if (requestRef.current === request) requestRef.current += 1
    }
  }, [artifactType, bytes, enabled, frameBytes, generation])

  return state.generation === generation
    ? {
        frames: state.frames,
        splitting: state.splitting,
        error: state.error,
      }
    : {
        frames: [],
        splitting: enabled,
        error: null,
      }
}
