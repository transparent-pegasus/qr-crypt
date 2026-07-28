import { readBarcodes } from "zxing-wasm/reader"

import { AppError as ConcreteAppError } from "@/crypto/errors"
import { FRAME_INTERVAL_MS_MIN } from "@/lib/limits"
import {
  acquireWithRetries,
  reportAttemptError,
  retryVideoPlayback,
  stopAttempt,
  stopStream,
  watchFrameReadiness,
  watchTrackEnds,
} from "@/qr/camera/acquire"
import { isActiveAttempt } from "@/qr/camera/attempt-registry"
import {
  cameraDiagnostic,
  cameraError,
  cameraTrack,
  diagnosticName,
  isFrameNotReadyDecodeError,
  publishPipelineDiagnostic,
  videoDimension,
} from "@/qr/camera/diagnostics"
import {
  CAMERA_DECODE_PROGRESS_TIMEOUT_MS,
  CAMERA_FRAME_READY_TIMEOUT_MS,
  QrDecodeProgressTimeout,
  zxingReaderOptions,
} from "@/qr/camera/reader-module"
import { AttemptCancelled } from "@/qr/camera/types"
import type {
  CameraAttempt,
  QrScanHandle,
  ScanContext,
  ScannerControls,
  ScannerPump,
} from "@/qr/camera/types"

const frameRetryDelayMs = 250
const decodeIntervalMs = FRAME_INTERVAL_MS_MIN
const maxFrameLongEdge = 1280

function scaledFrameDimensions(
  videoWidth: number,
  videoHeight: number,
): { width: number; height: number } {
  const longEdge = Math.max(videoWidth, videoHeight)
  const scale = Math.min(1, maxFrameLongEdge / longEdge)
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale)),
  }
}

function clearFrameReadyTimeout(attempt: CameraAttempt): void {
  if (attempt.frameReadyTimeoutId === undefined) return
  clearTimeout(attempt.frameReadyTimeoutId)
  attempt.frameReadyTimeoutId = undefined
}

function clearDecodeProgressTimeout(attempt: CameraAttempt): void {
  if (attempt.decodeProgressTimeoutId === undefined) return
  clearTimeout(attempt.decodeProgressTimeoutId)
  attempt.decodeProgressTimeoutId = undefined
}

function clearFrameRecovery(attempt: CameraAttempt): void {
  attempt.frameRecoveryActive = false
  attempt.lastFrameErrorName = undefined
  clearFrameReadyTimeout(attempt)
}

function failDecode(attempt: CameraAttempt, error: unknown): void {
  if (!isActiveAttempt(attempt)) return
  const mapped = cameraError(error)
  reportAttemptError(
    attempt,
    mapped,
    cameraDiagnostic(attempt, diagnosticName(error), attempt.phase),
  )
  stopAttempt(attempt)
}

function armDecodeProgressWatchdog(attempt: CameraAttempt): void {
  clearDecodeProgressTimeout(attempt)
  if (!isActiveAttempt(attempt) || !attempt.decodePumpStarted) return
  attempt.decodeProgressTimeoutId = setTimeout(() => {
    attempt.decodeProgressTimeoutId = undefined
    if (!isActiveAttempt(attempt) || !attempt.decodePumpStarted) return
    failDecode(attempt, new QrDecodeProgressTimeout())
  }, CAMERA_DECODE_PROGRESS_TIMEOUT_MS)
}

function completeDecodeAttempt(attempt: CameraAttempt, resultsSeen: number): void {
  attempt.decodeAttemptsCompleted += 1
  attempt.decodeResultsSeen += resultsSeen
  armDecodeProgressWatchdog(attempt)
  publishPipelineDiagnostic(attempt)
}

function ensureFrameReadyTimeout(attempt: CameraAttempt): void {
  if (attempt.frameReadyTimeoutId !== undefined) return
  attempt.frameReadyTimeoutId = setTimeout(() => {
    attempt.frameReadyTimeoutId = undefined
    if (!isActiveAttempt(attempt) || !attempt.frameRecoveryActive) return
    if (cameraTrack(attempt)?.readyState !== "live") return

    const mapped = new ConcreteAppError("CAMERA_NOT_AVAILABLE")
    reportAttemptError(
      attempt,
      mapped,
      cameraDiagnostic(attempt, attempt.lastFrameErrorName ?? "unknown", "playing"),
    )
    stopAttempt(attempt)
  }, CAMERA_FRAME_READY_TIMEOUT_MS)
}

function beginFrameRecovery(attempt: CameraAttempt, error: unknown): void {
  if (!isActiveAttempt(attempt)) return
  attempt.frameRecoveryActive = true
  attempt.lastFrameErrorName = diagnosticName(error)
  attempt.lastErrorName = attempt.lastFrameErrorName
  publishPipelineDiagnostic(attempt)
  ensureFrameReadyTimeout(attempt)
  retryVideoPlayback(attempt)
}

function cancelVideoFrameCallback(context: ScanContext, handle: number): void {
  const cancel = context.attempt.video.cancelVideoFrameCallback
  if (typeof cancel !== "function") return
  try {
    cancel.call(context.attempt.video, handle)
  } catch {
    // The callback may already have won the race with the fallback timer.
  }
}

function cancelScheduledFrame(context: ScanContext): void {
  const callbackHandle = context.pump.requestVideoFrameCallbackHandle
  context.pump.requestVideoFrameCallbackHandle = undefined
  if (callbackHandle !== undefined)
    cancelVideoFrameCallback(context, callbackHandle)

  if (context.pump.fallbackTimerId !== undefined) {
    clearTimeout(context.pump.fallbackTimerId)
    context.pump.fallbackTimerId = undefined
  }
}

function takeScheduledFrame(
  context: ScanContext,
  source: "video" | "timer",
  nextDecodeDeadline: number,
): void {
  if (source === "video") {
    context.pump.requestVideoFrameCallbackHandle = undefined
    if (context.pump.fallbackTimerId !== undefined) {
      clearTimeout(context.pump.fallbackTimerId)
      context.pump.fallbackTimerId = undefined
    }
  } else {
    context.pump.fallbackTimerId = undefined
    const callbackHandle = context.pump.requestVideoFrameCallbackHandle
    context.pump.requestVideoFrameCallbackHandle = undefined
    if (callbackHandle !== undefined)
      cancelVideoFrameCallback(context, callbackHandle)
  }

  if (
    context.pump.cancelled ||
    context.pump.decodeInFlight ||
    !isActiveAttempt(context.attempt)
  ) {
    return
  }

  if (Date.now() < nextDecodeDeadline) {
    scheduleNextFrame(context, nextDecodeDeadline)
    return
  }

  context.pump.decodeInFlight = true
  void decodeFrame(context)
}

function armFrameRace(
  context: ScanContext,
  nextDecodeDeadline: number,
  callbackFallbackDelayMs = 0,
): void {
  if (
    context.pump.cancelled ||
    context.pump.decodeInFlight ||
    !isActiveAttempt(context.attempt) ||
    context.pump.requestVideoFrameCallbackHandle !== undefined ||
    context.pump.fallbackTimerId !== undefined
  ) {
    return
  }

  // Early video callbacks re-arm with this unchanged absolute deadline. The timer
  // targets the same deadline, so a silent callback cannot add a second wait.
  let callbackRegistered = false
  let callbackFiredSynchronously = false
  let callbackRegistrationComplete = false
  const requestVideoFrameCallback =
    context.attempt.video.requestVideoFrameCallback
  if (typeof requestVideoFrameCallback === "function") {
    try {
      const callbackHandle = requestVideoFrameCallback.call(
        context.attempt.video,
        () => {
          if (!callbackRegistrationComplete) {
            callbackFiredSynchronously = true
            return
          }
          takeScheduledFrame(context, "video", nextDecodeDeadline)
        },
      )
      callbackRegistrationComplete = true
      if (!callbackFiredSynchronously) {
        context.pump.requestVideoFrameCallbackHandle = callbackHandle
        callbackRegistered = true
      } else if (Date.now() >= nextDecodeDeadline) {
        takeScheduledFrame(context, "video", nextDecodeDeadline)
      }
    } catch {
      callbackRegistrationComplete = true
      // Fall through to the timer scheduler when rVFC is unavailable at runtime.
    }
  }

  if (
    context.pump.cancelled ||
    context.pump.decodeInFlight ||
    !isActiveAttempt(context.attempt)
  ) {
    return
  }

  context.pump.fallbackTimerId = setTimeout(
    () => takeScheduledFrame(context, "timer", nextDecodeDeadline),
    Math.max(
      0,
      nextDecodeDeadline - Date.now(),
      callbackRegistered ? callbackFallbackDelayMs : 0,
    ),
  )
}

function scheduleNextFrame(
  context: ScanContext,
  nextDecodeDeadline = Date.now(),
  replaceScheduled = false,
  callbackFallbackDelayMs = 0,
): void {
  if (
    context.pump.cancelled ||
    context.pump.decodeInFlight ||
    !isActiveAttempt(context.attempt)
  )
    return

  if (
    context.pump.requestVideoFrameCallbackHandle !== undefined ||
    context.pump.fallbackTimerId !== undefined
  ) {
    if (!replaceScheduled) return
    cancelScheduledFrame(context)
  }

  armFrameRace(context, nextDecodeDeadline, callbackFallbackDelayMs)
}

async function decodeFrame(context: ScanContext): Promise<void> {
  let decodeStartedAt: number | undefined
  let decodeCallStarted = false
  let decodeCallCompleted = false
  try {
    if (!isActiveAttempt(context.attempt)) return

    const sourceWidth = videoDimension(context.attempt.video.videoWidth)
    const sourceHeight = videoDimension(context.attempt.video.videoHeight)
    if (sourceWidth === 0 || sourceHeight === 0) {
      throw new DOMException("Camera frame has no dimensions", "IndexSizeError")
    }
    if (cameraTrack(context.attempt)?.muted === true) {
      throw new DOMException("Camera frame is muted", "InvalidStateError")
    }

    const dimensions = scaledFrameDimensions(sourceWidth, sourceHeight)
    if (context.canvas.width !== dimensions.width)
      context.canvas.width = dimensions.width
    if (context.canvas.height !== dimensions.height)
      context.canvas.height = dimensions.height

    if (!isActiveAttempt(context.attempt)) return
    context.frameContext.drawImage(
      context.attempt.video,
      0,
      0,
      dimensions.width,
      dimensions.height,
    )
    context.attempt.videoFramesDrawn += 1
    // A successful draw proves scheduling progress and starts a fresh decode window.
    armDecodeProgressWatchdog(context.attempt)
    publishPipelineDiagnostic(context.attempt)
    clearFrameRecovery(context.attempt)

    const imageData = context.frameContext.getImageData(
      0,
      0,
      dimensions.width,
      dimensions.height,
    )
    if (!isActiveAttempt(context.attempt)) return

    decodeStartedAt = Date.now()
    decodeCallStarted = true
    const results = await readBarcodes(imageData, zxingReaderOptions)
    if (!isActiveAttempt(context.attempt)) return
    decodeCallCompleted = true
    completeDecodeAttempt(context.attempt, results.length)

    const result = results[0]
    if (result === undefined) return
    if (
      !isActiveAttempt(context.attempt) ||
      (context.once && context.attempt.emitted)
    )
      return

    const text = result.text
    if (!isActiveAttempt(context.attempt)) return
    context.attempt.emitted = true
    if (context.once) context.handle.stop()
    context.onText(text)
  } catch (error) {
    if (!isActiveAttempt(context.attempt)) return
    if (decodeCallStarted && !decodeCallCompleted) {
      completeDecodeAttempt(context.attempt, 0)
    }
    if (isFrameNotReadyDecodeError(context.attempt, error)) {
      beginFrameRecovery(context.attempt, error)
      return
    }
    failDecode(context.attempt, error)
  } finally {
    context.pump.decodeInFlight = false
    if (!context.pump.cancelled && isActiveAttempt(context.attempt)) {
      if (decodeStartedAt === undefined) {
        if (isActiveAttempt(context.attempt)) {
          scheduleNextFrame(context, Date.now() + frameRetryDelayMs)
        }
      } else {
        if (isActiveAttempt(context.attempt)) {
          scheduleNextFrame(context, decodeStartedAt + decodeIntervalMs)
        }
      }
    }
  }
}

export async function startAttempt(
  attempt: CameraAttempt,
  handle: QrScanHandle,
  onText: (text: string) => void,
  once: boolean,
): Promise<ScannerControls> {
  const stream = await acquireWithRetries(attempt)
  if (!isActiveAttempt(attempt)) {
    stopStream(stream, attempt.video)
    throw new AttemptCancelled()
  }

  attempt.stream = stream
  attempt.phase = "acquired"
  watchTrackEnds(attempt, stream)
  if (!isActiveAttempt(attempt)) throw new AttemptCancelled()
  attempt.video.srcObject = stream
  watchFrameReadiness(attempt, stream)

  const canvas = document.createElement("canvas")
  const canvasContext = canvas.getContext("2d", { willReadFrequently: true })
  if (canvasContext === null) throw new Error("Camera frame canvas is unavailable")
  const frameContext = canvasContext

  const pump: ScannerPump = {
    requestVideoFrameCallbackHandle: undefined,
    fallbackTimerId: undefined,
    decodeInFlight: false,
    cancelled: false,
    stop() {
      if (pump.cancelled) return
      pump.cancelled = true
      cancelScheduledFrame(context)
    },
  }
  const context: ScanContext = {
    attempt,
    pump,
    canvas,
    frameContext,
    once,
    handle,
    onText,
  }
  attempt.controls = pump
  attempt.decodePumpStarted = true
  armDecodeProgressWatchdog(attempt)
  attempt.phase = "playing"
  attempt.frameRecoveryActive = true
  attempt.lastFrameErrorName = undefined
  ensureFrameReadyTimeout(attempt)
  attempt.retryDecoder = () => scheduleNextFrame(context, Date.now(), true)
  // Preserve the initial rVFC grace period; the frame-readiness watchdog is already
  // armed. Steady-state scheduling above uses the cadence deadline with no added grace.
  scheduleNextFrame(context, Date.now(), false, frameRetryDelayMs)
  retryVideoPlayback(attempt)
  return pump
}
