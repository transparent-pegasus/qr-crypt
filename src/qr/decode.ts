// Camera QR scanning.
// Limit imports of @zxing/browser and @zxing/library to this module.
import type { AppError } from "@/crypto/errors"
import { BrowserQRCodeReader } from "@zxing/browser"
import { ChecksumException, FormatException, NotFoundException } from "@zxing/library"
import { AppError as ConcreteAppError } from "@/crypto/errors"

export interface QrScanHandle {
  // Idempotent. Stop controls and every MediaStreamTrack owned by this attempt.
  stop(): void
}

export interface StartQrScanOptions {
  // Defaults to true: stop automatically after the first success and ignore later
  // detections to prevent duplicate reads.
  once?: boolean
  signal?: AbortSignal
}

export type CameraDiagnosticPhase = "acquiring" | "acquired" | "playing" | "track-ended"

export interface CameraDiagnostic {
  phase: CameraDiagnosticPhase
  name: string | null
  detail: string
}

export type CameraScanState = "idle" | "acquiring" | "playing" | "failed" | "track-ended"

export const CAMERA_START_TIMEOUT_MS = 8_000
export const CAMERA_FRAME_READY_TIMEOUT_MS = 6_000

const maxAcquireRetries = 3
const acquireRetryDelayMs = 300
const frameRetryDelayMs = 250
const CAMERA_DIAGNOSTIC_NAME = /^[A-Za-z]{1,40}$/
const RETRYABLE_DECODE_KINDS = new Set([
  "NotFoundException",
  "ChecksumException",
  "FormatException",
])

interface ScannerControls {
  stop(): void
}

interface CameraAttempt {
  readonly id: number
  readonly video: HTMLVideoElement
  readonly onError: (error: AppError, diagnostic: CameraDiagnostic) => void
  readonly stoppedPromise: Promise<void>
  resolveStopped(): void
  phase: CameraDiagnosticPhase
  stopped: boolean
  emitted: boolean
  errorReported: boolean
  controls: ScannerControls | undefined
  stream: MediaStream | undefined
  failure: ConcreteAppError | undefined
  stoppedControls: Set<ScannerControls>
  endedListeners: Array<{
    track: MediaStreamTrack
    listener: EventListener
  }>
  frameListeners: Array<{
    target: EventTarget
    type: string
    listener: EventListener
  }>
  frameReadyTimeoutId: ReturnType<typeof setTimeout> | undefined
  decoderRestartTimeoutId: ReturnType<typeof setTimeout> | undefined
  decoderRestartInFlight: boolean
  frameRecoveryActive: boolean
  lastFrameErrorName: string | undefined
  retryDecoder: (() => void) | undefined
  abortSignal: AbortSignal | undefined
  abortListener: EventListener | undefined
}

class AttemptCancelled extends Error {}

let nextAttemptId = 0
let activeAttempt: CameraAttempt | null = null

// getUserMedia itself cannot be aborted, so serialize acquisition to prevent overtaking
// an unresolved request.
let cameraAcquisitionQueue: Promise<void> = Promise.resolve()

// true does not automatically restart; it directs the UI to transition to stopped
// and display the restart button.
export function shouldRestartQrScanOnVisibility(
  state: CameraScanState,
  visibilityState: DocumentVisibilityState,
): boolean {
  return visibilityState === "visible" && (state === "failed" || state === "track-ended")
}

function diagnosticName(error: unknown): string {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return "unknown"
  }
  try {
    const name = (error as { name?: unknown }).name
    return typeof name === "string" && CAMERA_DIAGNOSTIC_NAME.test(name)
      ? name
      : "unknown"
  } catch {
    return "unknown"
  }
}

function cameraTrack(attempt: CameraAttempt): MediaStreamTrack | undefined {
  const tracks = attempt.stream?.getTracks() ?? []
  return tracks.find((track) => track.kind === "video") ?? tracks[0]
}

function videoDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function hasVideoFrame(attempt: CameraAttempt): boolean {
  return (
    videoDimension(attempt.video.videoWidth) > 0 &&
    videoDimension(attempt.video.videoHeight) > 0
  )
}

function diagnosticDetail(attempt: CameraAttempt): string {
  const track = cameraTrack(attempt)
  const trackDetail =
    track === undefined
      ? "none"
      : `${track.readyState}/${track.muted ? "muted" : "unmuted"}`
  return `${videoDimension(attempt.video.videoWidth)}x${videoDimension(
    attempt.video.videoHeight,
  )} rs=${videoDimension(attempt.video.readyState)} track=${trackDetail}`
}

function cameraDiagnostic(
  attempt: CameraAttempt,
  name: string | null,
  phase: CameraDiagnosticPhase = attempt.phase,
): CameraDiagnostic {
  return {
    phase,
    name,
    detail: diagnosticDetail(attempt),
  }
}

function cameraError(error: unknown): ConcreteAppError {
  return new ConcreteAppError(
    diagnosticName(error) === "NotAllowedError"
      ? "CAMERA_PERMISSION_DENIED"
      : "CAMERA_NOT_AVAILABLE",
  )
}

function isTransientCameraAcquireError(error: unknown): boolean {
  const name = diagnosticName(error)
  return name === "NotReadableError" || name === "AbortError"
}

// getKind() on a ZXing Exception returns a per-class string literal that survives minification.
function zxingKind(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const getKind = (error as { getKind?: unknown }).getKind
  if (typeof getKind !== "function") return null
  try {
    const kind = (getKind as (this: unknown) => unknown).call(error)
    return typeof kind === "string" ? kind : null
  } catch {
    return null
  }
}

function isTransientDecodeError(error: unknown): boolean {
  // Minification shortens class names, so name checks do not work in production.
  // Check instanceof (single module instance), then getKind() (defense against duplicate
  // bundles), then name (tests and unbundled environments). ZXing's scan loop retries only
  // the three types above, so preserve every other type as fatal.
  if (
    error instanceof NotFoundException ||
    error instanceof ChecksumException ||
    error instanceof FormatException
  ) {
    return true
  }
  const kind = zxingKind(error)
  if (kind !== null) return RETRYABLE_DECODE_KINDS.has(kind)
  return RETRYABLE_DECODE_KINDS.has(diagnosticName(error))
}

function isFrameNotReadyDecodeError(attempt: CameraAttempt, error: unknown): boolean {
  if (cameraTrack(attempt)?.readyState !== "live") return false
  const name = diagnosticName(error)
  return (
    name === "IndexSizeError" || (name === "InvalidStateError" && !hasVideoFrame(attempt))
  )
}

function isActiveAttempt(attempt: CameraAttempt): boolean {
  return activeAttempt?.id === attempt.id && !attempt.stopped
}

function stopStream(stream: MediaStream, video: HTMLVideoElement): void {
  for (const track of stream.getTracks()) track.stop()
  if (video.srcObject === stream) video.srcObject = null
}

function stopControlsOnce(attempt: CameraAttempt, controls: ScannerControls): void {
  if (attempt.stoppedControls.has(controls)) return
  attempt.stoppedControls.add(controls)
  try {
    controls.stop()
  } catch {
    // Continue stopping owned tracks even if stopping controls fails.
  }
}

function stopAttempt(attempt: CameraAttempt): void {
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
  if (attempt.decoderRestartTimeoutId !== undefined) {
    clearTimeout(attempt.decoderRestartTimeoutId)
    attempt.decoderRestartTimeoutId = undefined
  }
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

  if (activeAttempt?.id === attempt.id) activeAttempt = null
}

function reportAttemptError(
  attempt: CameraAttempt,
  error: ConcreteAppError,
  diagnostic: CameraDiagnostic,
): void {
  if (!isActiveAttempt(attempt) || attempt.errorReported) return
  attempt.errorReported = true
  attempt.failure = error
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

function watchTrackEnds(attempt: CameraAttempt, stream: MediaStream): void {
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

function watchFrameReadiness(attempt: CameraAttempt, stream: MediaStream): void {
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

function retryVideoPlayback(attempt: CameraAttempt): void {
  if (!isActiveAttempt(attempt) || typeof attempt.video.play !== "function") return
  try {
    void attempt.video.play().catch(() => undefined)
  } catch {
    // Some implementations throw synchronously in a standalone PWA, so wait for the
    // next event/retry.
  }
}

async function acquireWithRetries(attempt: CameraAttempt): Promise<MediaStream> {
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

async function startAttempt(
  attempt: CameraAttempt,
  reader: BrowserQRCodeReader,
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

  function clearFrameReadyTimeout(): void {
    if (attempt.frameReadyTimeoutId === undefined) return
    clearTimeout(attempt.frameReadyTimeoutId)
    attempt.frameReadyTimeoutId = undefined
  }

  function clearDecoderRestartTimeout(): void {
    if (attempt.decoderRestartTimeoutId === undefined) return
    clearTimeout(attempt.decoderRestartTimeoutId)
    attempt.decoderRestartTimeoutId = undefined
  }

  function clearFrameRecovery(): void {
    attempt.frameRecoveryActive = false
    attempt.lastFrameErrorName = undefined
    clearFrameReadyTimeout()
    clearDecoderRestartTimeout()
  }

  function failDecode(error: unknown): void {
    if (!isActiveAttempt(attempt)) return
    const mapped = cameraError(error)
    reportAttemptError(
      attempt,
      mapped,
      cameraDiagnostic(attempt, diagnosticName(error), "playing"),
    )
    stopAttempt(attempt)
  }

  function ensureFrameReadyTimeout(): void {
    if (attempt.frameReadyTimeoutId !== undefined) return
    attempt.frameReadyTimeoutId = setTimeout(() => {
      attempt.frameReadyTimeoutId = undefined
      if (!isActiveAttempt(attempt) || !attempt.frameRecoveryActive) return
      if (hasVideoFrame(attempt)) {
        attempt.retryDecoder?.()
        return
      }
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

  function scheduleDecoderRestart(delayMs = frameRetryDelayMs): void {
    if (
      !isActiveAttempt(attempt) ||
      !attempt.frameRecoveryActive ||
      attempt.decoderRestartInFlight
    ) {
      return
    }
    if (hasVideoFrame(attempt)) clearFrameReadyTimeout()
    if (attempt.decoderRestartTimeoutId !== undefined) {
      if (delayMs !== 0) return
      clearDecoderRestartTimeout()
    }

    attempt.decoderRestartTimeoutId = setTimeout(() => {
      attempt.decoderRestartTimeoutId = undefined
      if (!isActiveAttempt(attempt) || !attempt.frameRecoveryActive) return
      const track = cameraTrack(attempt)
      if (track?.readyState !== "live") return
      if (!hasVideoFrame(attempt) || track.muted) {
        scheduleDecoderRestart()
        return
      }

      clearFrameReadyTimeout()
      retryVideoPlayback(attempt)
      attempt.decoderRestartInFlight = true
      void runDecoder()
        .catch((error: unknown) => {
          if (!isActiveAttempt(attempt)) return
          if (isFrameNotReadyDecodeError(attempt, error)) {
            beginFrameRecovery(error)
            return
          }
          failDecode(error)
        })
        .finally(() => {
          attempt.decoderRestartInFlight = false
          if (isActiveAttempt(attempt) && attempt.frameRecoveryActive) {
            scheduleDecoderRestart()
          }
        })
    }, delayMs)
  }

  function beginFrameRecovery(error: unknown, callbackControls?: ScannerControls): void {
    if (!isActiveAttempt(attempt)) return
    if (callbackControls !== undefined) {
      stopControlsOnce(attempt, callbackControls)
    }
    attempt.frameRecoveryActive = true
    attempt.lastFrameErrorName = diagnosticName(error)
    if (!hasVideoFrame(attempt)) ensureFrameReadyTimeout()
    retryVideoPlayback(attempt)
    scheduleDecoderRestart()
  }

  function handleDecode(
    result: { getText(): string } | undefined,
    error: unknown,
    callbackControls: ScannerControls,
  ): void {
    if (!isActiveAttempt(attempt)) {
      stopControlsOnce(attempt, callbackControls)
      return
    }
    attempt.controls = callbackControls
    attempt.phase = "playing"

    if (result !== undefined) {
      clearFrameRecovery()
      if (once && attempt.emitted) return
      attempt.emitted = true
      const text = result.getText()
      if (once) handle.stop()
      onText(text)
      return
    }

    if (error === undefined) return
    if (isTransientDecodeError(error)) {
      clearFrameRecovery()
      return
    }
    if (isFrameNotReadyDecodeError(attempt, error)) {
      beginFrameRecovery(error, callbackControls)
      return
    }
    failDecode(error)
  }

  async function runDecoder(): Promise<ScannerControls> {
    const controls = await reader.decodeFromVideoElement(attempt.video, handleDecode)
    if (!isActiveAttempt(attempt)) {
      stopControlsOnce(attempt, controls)
      throw new AttemptCancelled()
    }
    attempt.controls = controls
    attempt.phase = "playing"
    return controls
  }

  attempt.retryDecoder = () => scheduleDecoderRestart(0)
  const controls = await runDecoder()

  if (!isActiveAttempt(attempt)) {
    stopControlsOnce(attempt, controls)
    throw new AttemptCancelled()
  }
  attempt.controls = controls
  attempt.phase = "playing"
  return controls
}

type AttemptOutcome =
  | { kind: "ready"; controls: ScannerControls }
  | { kind: "error"; error: unknown }
  | { kind: "stopped" }
  | { kind: "timeout" }

// Continue scanning on NotFoundException (nothing detected). Retry only transient errors
// from initial camera acquisition. Separate acquisition, playback, and stopping with a
// generation ID and attempt-owned streams; stale generations must not touch UI state.
async function startQrScanImplementation(
  video: HTMLVideoElement,
  onText: (text: string) => void,
  onError: (error: AppError, diagnostic: CameraDiagnostic) => void,
  options?: StartQrScanOptions,
): Promise<QrScanHandle> {
  const previous = activeAttempt
  if (previous !== null) stopAttempt(previous)

  let resolveStopped: () => void = () => undefined
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStopped = resolve
  })
  const attempt: CameraAttempt = {
    id: ++nextAttemptId,
    video,
    onError,
    stoppedPromise,
    resolveStopped,
    phase: "acquiring",
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
    decoderRestartTimeoutId: undefined,
    decoderRestartInFlight: false,
    frameRecoveryActive: false,
    lastFrameErrorName: undefined,
    retryDecoder: undefined,
    abortSignal: undefined,
    abortListener: undefined,
  }
  activeAttempt = attempt

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

  const reader = new BrowserQRCodeReader()
  const operation: Promise<AttemptOutcome> = startAttempt(
    attempt,
    reader,
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
    timeoutId = setTimeout(() => resolve({ kind: "timeout" }), CAMERA_START_TIMEOUT_MS)
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
      reportAttemptError(attempt, mapped, cameraDiagnostic(attempt, "unknown"))
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
    reportAttemptError(
      attempt,
      mapped,
      cameraDiagnostic(attempt, diagnosticName(outcome.error)),
    )
    stopAttempt(attempt)
    throw mapped
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

export const startQrScan = Object.assign(startQrScanImplementation, {
  shouldRestartOnVisibility: shouldRestartQrScanOnVisibility,
})
