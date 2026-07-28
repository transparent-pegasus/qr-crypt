import { useEffect, useState } from "react"
import { probeWebAssemblyRuntime } from "@/lib/feature-detect"
import {
  CAMERA_READER_READY_TIMEOUT_MS,
  readerModuleState,
  warmQrReader,
} from "@/qr/decode"

const QR_READER_CLASSIFICATION_TIMEOUT_MS = 2_000

export type QrReaderReadiness = "preparing" | "ready" | "failed" | "blocked"

export function useQrReaderReadiness(): QrReaderReadiness {
  const [readiness, setReadiness] = useState<QrReaderReadiness>(() =>
    readerModuleState() === "ready" ? "ready" : "preparing",
  )

  useEffect(() => {
    if (readiness !== "preparing") return

    let settled = false
    let classificationTimeoutId: number | undefined
    const finish = (next: QrReaderReadiness) => {
      if (settled) return
      settled = true
      setReadiness(next)
    }
    // A never-settling preparation must still reach a terminal state, or the
    // control stays disabled with nothing on screen to explain it.
    const timeoutId = window.setTimeout(
      () => finish("failed"),
      CAMERA_READER_READY_TIMEOUT_MS,
    )
    warmQrReader().then(
      () => finish("ready"),
      () => {
        if (settled) return

        // A blocked runtime cannot be fixed by reloading, so the copy differs.
        // The probe is cached from boot; bound it too rather than trust it.
        let classificationSettled = false
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
      window.clearTimeout(timeoutId)
      if (classificationTimeoutId !== undefined) {
        window.clearTimeout(classificationTimeoutId)
      }
    }
  }, [readiness])

  return readiness
}
