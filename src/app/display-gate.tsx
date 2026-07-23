import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { clearAckPending, readAckPending, setAckPending } from "@/app/offline-ack-marker"

export interface DisplayGatePhase {
  online: boolean
  coldOffline: boolean
  sessionSawCommittedOnline: boolean
  offlineGeneration: number
  ackPending: boolean
  acceptedGeneration: number | null
}

interface DisplayGateContextValue extends DisplayGatePhase {
  acceptOfflineRisk: (generation: number) => boolean
  clearTransientForOnlineEpisode: () => void
}

const INITIAL_PHASE: DisplayGatePhase = {
  online: false,
  coldOffline: true,
  sessionSawCommittedOnline: false,
  offlineGeneration: 0,
  ackPending: false,
  acceptedGeneration: null,
}

function initialPhase(): DisplayGatePhase {
  if (!readAckPending()) return INITIAL_PHASE
  return {
    online: false,
    coldOffline: false,
    sessionSawCommittedOnline: false,
    offlineGeneration: 1,
    ackPending: true,
    acceptedGeneration: null,
  }
}

const DisplayGateContext = createContext<DisplayGateContextValue | null>(null)

function transitionPhase(current: DisplayGatePhase, online: boolean): DisplayGatePhase {
  if (current.online === online) return current
  if (online) {
    return {
      online: true,
      coldOffline: false,
      sessionSawCommittedOnline: true,
      offlineGeneration: current.offlineGeneration,
      ackPending: false,
      acceptedGeneration: null,
    }
  }

  const offlineGeneration = current.offlineGeneration + 1
  return {
    online: false,
    coldOffline: false,
    sessionSawCommittedOnline: true,
    offlineGeneration,
    ackPending: true,
    acceptedGeneration: null,
  }
}

export function DisplayGateProvider({
  children,
  clearTransient,
}: {
  children: ReactNode
  clearTransient: () => void
}) {
  const committedOnline = useOnlineStatus()
  const [phase, setPhase] = useState<DisplayGatePhase>(initialPhase)
  const phaseRef = useRef(phase)
  const transientClearedForOnlineEpisode = useRef(false)

  // Commit the observer snapshot in a layout effect so persistence never runs
  // during render. For an online observation, establish the marker before the
  // context publishes online=true to descendants.
  useLayoutEffect(() => {
    if (phase.online === committedOnline) return
    if (committedOnline) setAckPending()
    // This layout bridge is the observer's atomic commit boundary: delaying it
    // would let descendants paint with a stale online/ack combination.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase((current) => transitionPhase(current, committedOnline))
  }, [committedOnline, phase.online])

  const clearTransientForOnlineEpisode = useCallback(() => {
    if (transientClearedForOnlineEpisode.current) return
    transientClearedForOnlineEpisode.current = true
    clearTransient()
  }, [clearTransient])

  useLayoutEffect(() => {
    phaseRef.current = phase
    if (phase.online) {
      clearTransientForOnlineEpisode()
    } else if (phase.sessionSawCommittedOnline) {
      transientClearedForOnlineEpisode.current = false
    }
  }, [clearTransientForOnlineEpisode, phase])

  useEffect(() => {
    const resetEpisode = () => {
      transientClearedForOnlineEpisode.current = false
    }
    window.addEventListener("offline", resetEpisode)
    return () => window.removeEventListener("offline", resetEpisode)
  }, [])

  const acceptOfflineRisk = useCallback((generation: number): boolean => {
    const current = phaseRef.current
    if (
      current.online ||
      !current.ackPending ||
      current.offlineGeneration !== generation
    ) {
      return false
    }

    clearAckPending()
    const accepted: DisplayGatePhase = {
      ...current,
      ackPending: false,
      acceptedGeneration: generation,
    }
    phaseRef.current = accepted
    setPhase(accepted)
    return true
  }, [])

  const value = useMemo<DisplayGateContextValue>(
    () => ({
      ...phase,
      acceptOfflineRisk,
      clearTransientForOnlineEpisode,
    }),
    [acceptOfflineRisk, clearTransientForOnlineEpisode, phase],
  )

  return (
    <DisplayGateContext.Provider value={value}>{children}</DisplayGateContext.Provider>
  )
}

export function useDisplayGate(): DisplayGateContextValue {
  const value = useContext(DisplayGateContext)
  if (!value) {
    throw new Error("useDisplayGate must be used inside DisplayGateProvider")
  }
  return value
}
