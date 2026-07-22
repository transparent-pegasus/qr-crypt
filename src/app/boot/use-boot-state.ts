import { useEffect, useSyncExternalStore } from "react"
import type { BootState } from "@/app/boot/boot-contract"
import { getDefaultBootController, type BootController } from "@/app/boot/boot-controller"
import { installWipeBroadcastListener } from "@/app/boot/wipe-coordinator"

const SERVER_STATE: BootState = { kind: "unknown" }

export interface UseBootStateOptions {
  controller?: BootController
  resetTransient?: () => void
}

export function useBootState(options: UseBootStateOptions = {}): BootState {
  const controller = options.controller ?? getDefaultBootController()
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    () => SERVER_STATE,
  )

  useEffect(() => {
    if (!options.resetTransient) return
    return controller.addTransientResetHandler(options.resetTransient)
  }, [controller, options.resetTransient])

  useEffect(() => {
    if (!options.resetTransient) return
    return installWipeBroadcastListener({ resetTransient: options.resetTransient })
  }, [options.resetTransient])

  useEffect(() => {
    controller.acquire()
    return () => controller.release()
  }, [controller])

  return state
}
