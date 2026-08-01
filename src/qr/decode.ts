import type { AppError } from "@/crypto/errors"
import { AppError as ConcreteAppError } from "@/crypto/errors"
import {
  reportAttemptError,
  stopAttempt,
  stopControlsOnce,
} from "@/qr/camera/acquire"
import {
  activateAttempt,
  createAttemptId,
  currentAttempt,
  isActiveAttempt,
} from "@/qr/camera/attempt-registry"
import { cameraError } from "@/qr/camera/diagnostics"
import { startAttempt } from "@/qr/camera/frame-pump"
import {
  CAMERA_START_TIMEOUT_MS,
  prepareQrReaderModule,
  readerModuleState,
} from "@/qr/camera/reader-module"
import { AttemptCancelled } from "@/qr/camera/types"
import type {
  CameraAttempt,
  CameraFailureState,
  CameraScanState,
  QrScanHandle,
  ScannerControls,
  StartQrScanOptions,
} from "@/qr/camera/types"

export {
  CAMERA_DECODE_PROGRESS_TIMEOUT_MS,
  CAMERA_FRAME_READY_TIMEOUT_MS,
  CAMERA_READER_READY_TIMEOUT_MS,
  CAMERA_START_TIMEOUT_MS,
} from "@/qr/camera/reader-module"
export { readerModuleState }

export type {
  CameraFailureState,
  CameraScanState,
  QrScanHandle,
} from "@/qr/camera/types"

// Fetch and compile the reader ahead of any tap. The shared readiness gate awaits this
// promise before enabling capture and owns presentation of a latched failure.
export function warmQrReader(): Promise<void> {
  return prepareQrReaderModule()
}

// true does not automatically restart; it directs the UI to transition to stopped
// and display the restart button.
export function shouldRestartQrScanOnVisibility(
  state: CameraScanState,
  visibilityState: DocumentVisibilityState,
): boolean {
  return visibilityState === "visible" && (state === "failed" || state === "track-ended")
}

type AttemptOutcome =
  | { kind: "ready"; controls: ScannerControls }
  | { kind: "error"; error: unknown }
  | { kind: "stopped" }
  | { kind: "timeout" }

// Continue scanning when a frame contains no QR result. Retry only transient errors from
// initial camera acquisition. Separate acquisition, playback, and stopping with a generation
// ID and attempt-owned streams; stale generations must not touch UI state.
async function startQrScanImplementation(
  video: HTMLVideoElement,
  onText: (text: string) => void,
  onError: (error: AppError, failureState: CameraFailureState) => void,
  options?: StartQrScanOptions,
): Promise<QrScanHandle> {
  // The UI gate is not the security boundary: future direct callers must not
  // acquire a camera or reach zxing-wasm while its same-origin override is
  // absent, pending, or latched failed.
  if (readerModuleState() !== "ready") {
    throw new ConcreteAppError("QR_READER_BLOCKED")
  }

  const previous = currentAttempt()
  if (previous !== null) stopAttempt(previous)

  let resolveStopped: () => void = () => undefined
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStopped = resolve
  })
  const attempt: CameraAttempt = {
    id: createAttemptId(),
    video,
    onError,
    stoppedPromise,
    resolveStopped,
    stopped: false,
    emitted: false,
    errorReported: false,
    controls: undefined,
    stream: undefined,
    failure: undefined,
    stoppedControls: new Set(),
    endedListeners: [],
    frameListeners: [],
    frameReadyTimeoutId: undefined,
    decodeProgressTimeoutId: undefined,
    frameRecoveryActive: false,
    decodePumpStarted: false,
    retryDecoder: undefined,
    abortSignal: undefined,
    abortListener: undefined,
  }
  activateAttempt(attempt)

  const handle: QrScanHandle = {
    stop() {
      stopAttempt(attempt)
    },
  }

  const signal = options?.signal
  if (signal !== undefined) {
    const onAbort = () => stopAttempt(attempt)
    attempt.abortSignal = signal
    attempt.abortListener = onAbort
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  }

  if (!isActiveAttempt(attempt)) {
    throw attempt.failure ?? new ConcreteAppError("CAMERA_NOT_AVAILABLE")
  }

  // Reuse the already-ready generation. The fail-closed check above guarantees
  // that a latched failure cannot reach zxing-wasm after its module was purged.
  prepareQrReaderModule()

  const operation: Promise<AttemptOutcome> = startAttempt(
    attempt,
    handle,
    onText,
    options?.once ?? true,
  ).then(
    (controls) => ({ kind: "ready", controls }),
    (error: unknown) => ({ kind: "error", error }),
  )
  const stopped: Promise<AttemptOutcome> = attempt.stoppedPromise.then(() => ({
    kind: "stopped",
  }))
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<AttemptOutcome>((resolve) => {
    timeoutId = setTimeout(() => {
      // Once the pump owns a decode-progress watchdog, let its distinct error
      // resolve a stalled playback/scheduler path instead of collapsing it into the
      // generic startup timeout.
      if (attempt.decodePumpStarted) return
      resolve({ kind: "timeout" })
    }, CAMERA_START_TIMEOUT_MS)
  })

  try {
    const outcome = await Promise.race([operation, stopped, timeout])
    if (outcome.kind === "ready") {
      if (!isActiveAttempt(attempt)) {
        stopControlsOnce(attempt, outcome.controls)
        throw attempt.failure ?? new ConcreteAppError("CAMERA_NOT_AVAILABLE")
      }
      return handle
    }

    if (outcome.kind === "timeout") {
      const mapped = new ConcreteAppError("CAMERA_NOT_AVAILABLE")
      reportAttemptError(attempt, mapped)
      stopAttempt(attempt)
      throw mapped
    }

    if (outcome.kind === "stopped") {
      throw attempt.failure ?? new ConcreteAppError("CAMERA_NOT_AVAILABLE")
    }

    if (outcome.error instanceof AttemptCancelled || !isActiveAttempt(attempt)) {
      throw attempt.failure ?? new ConcreteAppError("CAMERA_NOT_AVAILABLE")
    }

    const mapped = cameraError(outcome.error)
    reportAttemptError(attempt, mapped)
    stopAttempt(attempt)
    throw mapped
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

export const startQrScan = Object.assign(startQrScanImplementation, {
  shouldRestartOnVisibility: shouldRestartQrScanOnVisibility,
})
