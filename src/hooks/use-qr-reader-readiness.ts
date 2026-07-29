import { useEffect, useState } from "react"
import { probeWebAssemblyRuntime } from "@/lib/feature-detect"
import {
  CAMERA_READER_READY_TIMEOUT_MS,
  readerModuleState,
  warmQrReader,
} from "@/qr/decode"

const QR_READER_CLASSIFICATION_TIMEOUT_MS = 2_000

export type QrReaderReadiness = "preparing" | "ready" | "failed" | "blocked"

/**
 * `enabled` exists for the online relay: that surface must not pull the reader
 * at runtime until the user actually asks for the camera, which
 * tests/e2e/offline-pwa.spec.ts pins as a contract of the online gate. Offline
 * scanners pass nothing and warm on mount.
 */
export function useQrReaderReadiness(enabled = true): QrReaderReadiness {
  const [readiness, setReadiness] = useState<QrReaderReadiness>(() => {
    const moduleState = readerModuleState()
    if (moduleState === "ready") return "ready"
    if (moduleState === "failed") return "failed"
    return "preparing"
  })

  useEffect(() => {
    if (!enabled || readiness !== "preparing") return

    let settled = false
    let classificationSettled = false
    let timeoutId: number | undefined
    let classificationTimeoutId: number | undefined
    const finish = (next: QrReaderReadiness) => {
      if (settled) return
      settled = true
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
        timeoutId = undefined
      }
      setReadiness(next)
    }
    // A never-settling preparation must still reach a terminal state, or the
    // control stays disabled with nothing on screen to explain it.
    timeoutId = window.setTimeout(
      () => finish("failed"),
      CAMERA_READER_READY_TIMEOUT_MS,
    )
    warmQrReader().then(
      () => finish("ready"),
      () => {
        if (settled) return

        // A blocked runtime cannot be fixed by reloading, so the copy differs.
        // The probe is cached from boot; bound it too rather than trust it.
        const finishClassification = (next: QrReaderReadiness) => {
          if (classificationSettled) return
          classificationSettled = true
          if (classificationTimeoutId !== undefined) {
            window.clearTimeout(classificationTimeoutId)
            classificationTimeoutId = undefined
          }
          finish(next)
        }
        classificationTimeoutId = window.setTimeout(
          () => finishClassification("failed"),
          QR_READER_CLASSIFICATION_TIMEOUT_MS,
        )
        void probeWebAssemblyRuntime().then((available) =>
          finishClassification(available ? "failed" : "blocked"),
        )
      },
    )

    return () => {
      settled = true
      classificationSettled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      if (classificationTimeoutId !== undefined) {
        window.clearTimeout(classificationTimeoutId)
      }
    }
  }, [enabled, readiness])

  return readiness
}
