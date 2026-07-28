import { AppError as ConcreteAppError } from "@/crypto/errors"
import {
  clearAttempt,
  isActiveAttempt,
} from "@/qr/camera/attempt-registry"
import {
  cameraDiagnostic,
  isTransientCameraAcquireError,
  publishPipelineDiagnostic,
} from "@/qr/camera/diagnostics"
import { AttemptCancelled } from "@/qr/camera/types"
import type {
  CameraAttempt,
  CameraDiagnostic,
  ScannerControls,
} from "@/qr/camera/types"

const maxAcquireRetries = 3
const acquireRetryDelayMs = 300

// getUserMedia itself cannot be aborted, so serialize acquisition to prevent overtaking
// an unresolved request.
let cameraAcquisitionQueue: Promise<void> = Promise.resolve()

export function stopStream(stream: MediaStream, video: HTMLVideoElement): void {
  for (const track of stream.getTracks()) track.stop()
  if (video.srcObject === stream) video.srcObject = null
}

export function stopControlsOnce(
  attempt: CameraAttempt,
  controls: ScannerControls,
): void {
  if (attempt.stoppedControls.has(controls)) return
  attempt.stoppedControls.add(controls)
  try {
    controls.stop()
  } catch {
    // Continue stopping owned tracks even if stopping controls fails.
  }
}

export function stopAttempt(attempt: CameraAttempt): void {
  if (attempt.stopped) return
  attempt.stopped = true
  attempt.resolveStopped()

  if (attempt.abortSignal !== undefined && attempt.abortListener !== undefined) {
    attempt.abortSignal.removeEventListener("abort", attempt.abortListener)
    attempt.abortSignal = undefined
    attempt.abortListener = undefined
  }

  if (attempt.frameReadyTimeoutId !== undefined) {
    clearTimeout(attempt.frameReadyTimeoutId)
    attempt.frameReadyTimeoutId = undefined
  }
  if (attempt.decodeProgressTimeoutId !== undefined) {
    clearTimeout(attempt.decodeProgressTimeoutId)
    attempt.decodeProgressTimeoutId = undefined
  }
  attempt.decodePumpStarted = false
  attempt.retryDecoder = undefined

  for (const { track, listener } of attempt.endedListeners) {
    track.removeEventListener("ended", listener)
  }
  attempt.endedListeners = []

  for (const { target, type, listener } of attempt.frameListeners) {
    target.removeEventListener(type, listener)
  }
  attempt.frameListeners = []

  if (attempt.controls !== undefined) stopControlsOnce(attempt, attempt.controls)
  attempt.controls = undefined

  const stream = attempt.stream
  attempt.stream = undefined
  if (stream !== undefined) stopStream(stream, attempt.video)

  clearAttempt(attempt)
}

export function reportAttemptError(
  attempt: CameraAttempt,
  error: ConcreteAppError,
  diagnostic: CameraDiagnostic,
): void {
  if (!isActiveAttempt(attempt) || attempt.errorReported) return
  attempt.errorReported = true
  attempt.failure = error
  if (diagnostic.name !== null) attempt.lastErrorName = diagnostic.name
  publishPipelineDiagnostic(attempt)
  attempt.onError(error, diagnostic)
}

function acquireCamera(attempt: CameraAttempt): Promise<MediaStream> {
  const acquisition = cameraAcquisitionQueue.then(async () => {
    if (!isActiveAttempt(attempt)) throw new AttemptCancelled()

    // Without a requested resolution, many devices return 640×480, reducing a key QR
    // (~100 modules) to 2–3px per module and making it undecodable even when stationary.
    // An unmet ideal constraint does not reject acquisition.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    })
    if (!isActiveAttempt(attempt)) {
      stopStream(stream, attempt.video)
      throw new AttemptCancelled()
    }
    return stream
  })

  // Failures do not break the queue. Do not start the next acquisition until the current
  // acquisition promise actually settles.
  cameraAcquisitionQueue = acquisition.then(
    () => undefined,
    () => undefined,
  )
  return acquisition
}

export function watchTrackEnds(
  attempt: CameraAttempt,
  stream: MediaStream,
): void {
  const onEnded: EventListener = () => {
    if (!isActiveAttempt(attempt)) return
    attempt.phase = "track-ended"
    const error = new ConcreteAppError("CAMERA_NOT_AVAILABLE")
    reportAttemptError(attempt, error, cameraDiagnostic(attempt, null, "track-ended"))
    stopAttempt(attempt)
  }

  for (const track of stream.getTracks()) {
    track.addEventListener("ended", onEnded)
    attempt.endedListeners.push({ track, listener: onEnded })
  }

  if (stream.getTracks().some((track) => track.readyState === "ended"))
    onEnded(new Event("ended"))
}

export function watchFrameReadiness(
  attempt: CameraAttempt,
  stream: MediaStream,
): void {
  const onPotentialFrame: EventListener = () => {
    if (!isActiveAttempt(attempt) || !attempt.frameRecoveryActive) return
    retryVideoPlayback(attempt)
    attempt.retryDecoder?.()
  }
  const addListener = (target: EventTarget, type: string) => {
    target.addEventListener(type, onPotentialFrame)
    attempt.frameListeners.push({ target, type, listener: onPotentialFrame })
  }

  addListener(attempt.video, "resize")
  addListener(attempt.video, "loadedmetadata")
  for (const track of stream.getTracks()) addListener(track, "unmute")
}

export function retryVideoPlayback(attempt: CameraAttempt): void {
  if (!isActiveAttempt(attempt) || typeof attempt.video.play !== "function") return
  try {
    void attempt.video.play().catch(() => undefined)
  } catch {
    // Some implementations throw synchronously in a standalone PWA, so wait for the
    // next event/retry.
  }
}

export async function acquireWithRetries(
  attempt: CameraAttempt,
): Promise<MediaStream> {
  let retries = 0
  while (true) {
    if (!isActiveAttempt(attempt)) throw new AttemptCancelled()
    attempt.phase = "acquiring"
    try {
      return await acquireCamera(attempt)
    } catch (error) {
      if (
        error instanceof AttemptCancelled ||
        !isTransientCameraAcquireError(error) ||
        retries >= maxAcquireRetries
      ) {
        throw error
      }
      if (!isActiveAttempt(attempt)) throw new AttemptCancelled()
      retries += 1
      await new Promise<void>((resolve) => {
        setTimeout(resolve, acquireRetryDelayMs)
      })
    }
  }
}
