// Camera QR scanning through the reader-only zxing-wasm build.
// Keep the camera decoder and its same-origin WASM routing isolated to this module.
import {
  prepareZXingModule,
  purgeZXingModule,
  readBarcodes,
  type ReaderOptions,
  type ZXingModuleOverrides,
} from "zxing-wasm/reader"
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"

import type { AppError } from "@/crypto/errors"
import { AppError as ConcreteAppError } from "@/crypto/errors"
import {
  hasWebAssemblyInstantiationApi,
  probeWebAssemblyRuntime,
} from "@/lib/feature-detect"
import { FRAME_INTERVAL_MS_MIN } from "@/lib/limits"

export interface QrScanHandle {
  // Idempotent. Stop controls and every MediaStreamTrack owned by this attempt.
  stop(): void
}

export type ReaderModuleState =
  | "idle"
  | "preparing"
  | "ready"
  | "failed"
  | "timed-out"

export interface CameraPipelineDiagnostic {
  readerModuleState: ReaderModuleState
  videoFramesDrawn: number
  decodeAttemptsCompleted: number
  decodeResultsSeen: number
  lastErrorName: string | null
}

export interface StartQrScanOptions {
  // Defaults to true: stop automatically after the first success and ignore later
  // detections to prevent duplicate reads.
  once?: boolean
  signal?: AbortSignal
  onDiagnostic?: (diagnostic: CameraPipelineDiagnostic) => void
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
// A cached one-megabyte reader should fetch and compile within the same eight-second
// budget as camera startup. Bounding it here prevents a successful first draw from
// clearing the frame-readiness watchdog and then waiting on WebKit forever.
export const CAMERA_READER_PREPARATION_TIMEOUT_MS = CAMERA_START_TIMEOUT_MS
// Two frame-readiness windows leave the reader timeout above time to identify itself
// first, while remaining far beyond the healthy 200 ms empty-decode cadence.
export const CAMERA_DECODE_PROGRESS_TIMEOUT_MS = CAMERA_FRAME_READY_TIMEOUT_MS * 2

const maxAcquireRetries = 3
const acquireRetryDelayMs = 300
const frameRetryDelayMs = 250
const decodeIntervalMs = FRAME_INTERVAL_MS_MIN
const maxFrameLongEdge = 1280
const CAMERA_DIAGNOSTIC_NAME = /^[A-Za-z]{1,40}$/

const zxingModuleOverrides: ZXingModuleOverrides = {
  locateFile(path: string, scriptDirectory: string) {
    return path.endsWith(".wasm") ? wasmUrl : scriptDirectory + path
  },
}

const zxingReaderOptions: ReaderOptions = {
  formats: ["QRCodeModel2"],
  returnErrors: false,
  maxNumberOfSymbols: 1,
  tryInvert: true,
  tryRotate: true,
  tryHarder: true,
  tryDownscale: true,
}

let zxingModulePromise: Promise<void> | undefined
let zxingModuleState: ReaderModuleState = "idle"

interface ScannerControls {
  stop(): void
}

interface ScannerPump extends ScannerControls {
  requestVideoFrameCallbackHandle: number | undefined
  fallbackTimerId: ReturnType<typeof setTimeout> | undefined
  decodeInFlight: boolean
  cancelled: boolean
}

interface CameraAttempt {
  readonly id: number
  readonly video: HTMLVideoElement
  readonly onError: (error: AppError, diagnostic: CameraDiagnostic) => void
  readonly onDiagnostic:
    | ((diagnostic: CameraPipelineDiagnostic) => void)
    | undefined
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
  decodeProgressTimeoutId: ReturnType<typeof setTimeout> | undefined
  frameRecoveryActive: boolean
  decodePumpStarted: boolean
  readerModuleState: ReaderModuleState
  videoFramesDrawn: number
  decodeAttemptsCompleted: number
  decodeResultsSeen: number
  lastErrorName: string | null
  lastFrameErrorName: string | undefined
  retryDecoder: (() => void) | undefined
  cancelModulePreparationWait: (() => void) | undefined
  abortSignal: AbortSignal | undefined
  abortListener: EventListener | undefined
}

class AttemptCancelled extends Error {}

class QrReaderPreparationTimeout extends Error {
  constructor() {
    super("QR reader preparation timed out")
    this.name = "QrReaderPreparationTimeout"
  }
}

class QrDecodeProgressTimeout extends Error {
  constructor() {
    super("QR decoding made no progress")
    this.name = "QrDecodeProgressTimeout"
  }
}

let nextAttemptId = 0
let activeAttempt: CameraAttempt | null = null

// getUserMedia itself cannot be aborted, so serialize acquisition to prevent overtaking
// an unresolved request.
let cameraAcquisitionQueue: Promise<void> = Promise.resolve()

// Start (or reuse) WASM preparation WITHOUT awaiting it. iOS Safari only opens the
// camera permission prompt while the user activation from the tap is still live, and
// fetching plus compiling a one-megabyte binary outlives that window. Acquisition must
// therefore reach getUserMedia first; the decoder awaits this promise later, after the
// first frame has been drawn.
function prepareQrReaderModule(): Promise<void> {
  const existing = zxingModulePromise
  if (existing !== undefined) return existing

  if (!hasWebAssemblyInstantiationApi()) {
    zxingModuleState = "failed"
    const unsupported = Promise.reject(
      new Error("WebAssembly is unavailable for the QR reader"),
    )
    void unsupported.catch(() => undefined)
    return unsupported
  }

  let started: Promise<unknown>
  zxingModuleState = "preparing"
  try {
    started = prepareZXingModule({
      overrides: zxingModuleOverrides,
      fireImmediately: true,
    })
  } catch (error) {
    zxingModuleState = "failed"
    purgeZXingModule()
    const rejected = Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    )
    void rejected.catch(() => undefined)
    return rejected
  }

  const preparation = started.then(() => {
    // Symmetric with the rejection guard below: purgeZXingModule cannot cancel an
    // in-flight instantiation, so a superseded generation can still settle. It must not
    // declare the reader ready on behalf of the generation that replaced it — a false
    // "ready" makes the next attempt skip its bounded wait and block inside readBarcodes.
    if (zxingModulePromise !== preparation) return
    zxingModuleState = "ready"
    if (activeAttempt !== null) publishPipelineDiagnostic(activeAttempt)
  })
  zxingModulePromise = preparation
  // Reset on failure so the restart button can retry, and swallow the rejection here:
  // an attempt can stop before any decode awaits this promise. Cleanup runs to
  // completion before the diagnostic, because a synchronous callback can start a fresh
  // preparation and must not have it purged from under it.
  void preparation.catch(() => {
    if (zxingModulePromise !== preparation) return
    zxingModulePromise = undefined
    zxingModuleState = "failed"
    purgeZXingModule()
    if (activeAttempt !== null) publishPipelineDiagnostic(activeAttempt)
  })
  return preparation
}

// Tear down only the generation that actually failed. If a newer preparation is already
// cached — started by a diagnostic callback, a warm-up, or another attempt — leave it
// alone so the retry adopts it instead of erasing it.
function invalidateQrReaderModule(failed: Promise<void>): void {
  if (zxingModulePromise !== undefined && zxingModulePromise !== failed) return
  zxingModulePromise = undefined
  zxingModuleState = "idle"
  purgeZXingModule()
}

// Fetch and compile the reader ahead of any tap. iOS Safari raises the camera permission
// prompt while a cold one-megabyte fetch is still in flight, and losing that fetch aborts
// the Emscripten runtime. Warming on mount takes the fetch off the acquisition path
// entirely; the rejection is swallowed because nothing awaits a warm-up.
export function warmQrReader(): void {
  void prepareQrReaderModule().catch(() => undefined)
}

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

function pipelineDiagnostic(attempt: CameraAttempt): CameraPipelineDiagnostic {
  if (
    (attempt.readerModuleState === "idle" ||
      attempt.readerModuleState === "preparing") &&
    zxingModuleState !== "idle"
  ) {
    attempt.readerModuleState = zxingModuleState
  }
  return {
    readerModuleState: attempt.readerModuleState,
    videoFramesDrawn: attempt.videoFramesDrawn,
    decodeAttemptsCompleted: attempt.decodeAttemptsCompleted,
    decodeResultsSeen: attempt.decodeResultsSeen,
    lastErrorName: attempt.lastErrorName,
  }
}

function publishPipelineDiagnostic(attempt: CameraAttempt): void {
  if (!isActiveAttempt(attempt) || attempt.onDiagnostic === undefined) return
  try {
    attempt.onDiagnostic(pipelineDiagnostic(attempt))
  } catch {
    // Diagnostics must never become another scanner failure path.
  }
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
  if (error instanceof ConcreteAppError) return error

  const name = diagnosticName(error)
  if (name === "QrReaderPreparationTimeout") {
    return new ConcreteAppError("QR_READER_PREPARATION_TIMEOUT")
  }
  if (name === "QrDecodeProgressTimeout") {
    return new ConcreteAppError("QR_DECODE_PROGRESS_TIMEOUT")
  }
  return new ConcreteAppError(
    name === "NotAllowedError"
      ? "CAMERA_PERMISSION_DENIED"
      : "CAMERA_NOT_AVAILABLE",
  )
}

function isTransientCameraAcquireError(error: unknown): boolean {
  const name = diagnosticName(error)
  return name === "NotReadableError" || name === "AbortError"
}

function isFrameNotReadyDecodeError(attempt: CameraAttempt, error: unknown): boolean {
  if (cameraTrack(attempt)?.readyState !== "live") return false
  const name = diagnosticName(error)
  return name === "IndexSizeError" || name === "InvalidStateError"
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
  const cancelModulePreparationWait = attempt.cancelModulePreparationWait
  attempt.cancelModulePreparationWait = undefined
  cancelModulePreparationWait?.()
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
  handle: QrScanHandle,
  onText: (text: string) => void,
  once: boolean,
  modulePreparation: Promise<void>,
  webAssemblyRuntimeSupport: Promise<boolean>,
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
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (context === null) throw new Error("Camera frame canvas is unavailable")
  const frameContext = context

  const pump: ScannerPump = {
    requestVideoFrameCallbackHandle: undefined,
    fallbackTimerId: undefined,
    decodeInFlight: false,
    cancelled: false,
    stop() {
      if (pump.cancelled) return
      pump.cancelled = true
      cancelScheduledFrame()
    },
  }
  function clearFrameReadyTimeout(): void {
    if (attempt.frameReadyTimeoutId === undefined) return
    clearTimeout(attempt.frameReadyTimeoutId)
    attempt.frameReadyTimeoutId = undefined
  }

  function clearDecodeProgressTimeout(): void {
    if (attempt.decodeProgressTimeoutId === undefined) return
    clearTimeout(attempt.decodeProgressTimeoutId)
    attempt.decodeProgressTimeoutId = undefined
  }

  function clearFrameRecovery(): void {
    attempt.frameRecoveryActive = false
    attempt.lastFrameErrorName = undefined
    clearFrameReadyTimeout()
  }

  function failDecode(error: unknown): void {
    if (!isActiveAttempt(attempt)) return
    const mapped = cameraError(error)
    reportAttemptError(
      attempt,
      mapped,
      cameraDiagnostic(attempt, diagnosticName(error)),
    )
    stopAttempt(attempt)
  }

  function armDecodeProgressWatchdog(): void {
    clearDecodeProgressTimeout()
    if (!isActiveAttempt(attempt) || !attempt.decodePumpStarted) return
    attempt.decodeProgressTimeoutId = setTimeout(() => {
      attempt.decodeProgressTimeoutId = undefined
      if (!isActiveAttempt(attempt) || !attempt.decodePumpStarted) return
      failDecode(new QrDecodeProgressTimeout())
    }, CAMERA_DECODE_PROGRESS_TIMEOUT_MS)
  }

  async function awaitPreparation(preparation: Promise<void>): Promise<void> {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let resolveWait: () => void = () => undefined
    let rejectWait: (error: unknown) => void = () => undefined
    const wait = new Promise<void>((resolve, reject) => {
      resolveWait = resolve
      rejectWait = reject
    })
    const clearWaitTimeout = () => {
      if (timeoutId === undefined) return
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    const settleReady = () => {
      if (settled) return
      settled = true
      clearWaitTimeout()
      resolveWait()
    }
    const settleFailed = (error: unknown) => {
      if (settled) return
      settled = true
      clearWaitTimeout()
      rejectWait(error)
    }
    timeoutId = setTimeout(
      () => settleFailed(new QrReaderPreparationTimeout()),
      CAMERA_READER_PREPARATION_TIMEOUT_MS,
    )
    const cancelWait = () => settleFailed(new AttemptCancelled())
    attempt.cancelModulePreparationWait = cancelWait
    void preparation.then(settleReady, settleFailed)

    try {
      await wait
    } finally {
      clearWaitTimeout()
      if (attempt.cancelModulePreparationWait === cancelWait) {
        attempt.cancelModulePreparationWait = undefined
      }
    }
  }

  let readerRetryUsed = false

  async function waitForReaderModulePreparation(): Promise<void> {
    if (attempt.readerModuleState === "ready" || zxingModuleState === "ready") {
      attempt.readerModuleState = "ready"
      publishPipelineDiagnostic(attempt)
      return
    }

    let preparation = modulePreparation
    for (;;) {
      try {
        await awaitPreparation(preparation)
        attempt.readerModuleState = "ready"
        publishPipelineDiagnostic(attempt)
        return
      } catch (error) {
        // A cancelled attempt is being torn down, and a timeout already spent the full
        // budget — retrying it would hold a live camera for a second empty window.
        const retryable =
          !readerRetryUsed &&
          !(error instanceof AttemptCancelled) &&
          !(error instanceof QrReaderPreparationTimeout) &&
          isActiveAttempt(attempt)
        if (!retryable) {
          if (!(error instanceof AttemptCancelled) && isActiveAttempt(attempt)) {
            attempt.readerModuleState =
              error instanceof QrReaderPreparationTimeout ? "timed-out" : "failed"
            attempt.lastErrorName = diagnosticName(error)
            publishPipelineDiagnostic(attempt)
          }
          throw error
        }
        readerRetryUsed = true
        attempt.lastErrorName = diagnosticName(error)
        invalidateQrReaderModule(preparation)
        preparation = prepareQrReaderModule()
        // pipelineDiagnostic only mirrors the module state while the attempt field is
        // idle or preparing, so publishing before this assignment would latch "failed"
        // for the whole retry window.
        attempt.readerModuleState = "preparing"
        publishPipelineDiagnostic(attempt)
      }
    }
  }

  function completeDecodeAttempt(resultsSeen: number): void {
    attempt.decodeAttemptsCompleted += 1
    attempt.decodeResultsSeen += resultsSeen
    armDecodeProgressWatchdog()
    publishPipelineDiagnostic(attempt)
  }

  function ensureFrameReadyTimeout(): void {
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

  function cancelVideoFrameCallback(handle: number): void {
    const cancel = attempt.video.cancelVideoFrameCallback
    if (typeof cancel !== "function") return
    try {
      cancel.call(attempt.video, handle)
    } catch {
      // The callback may already have won the race with the fallback timer.
    }
  }

  function cancelScheduledFrame(): void {
    const callbackHandle = pump.requestVideoFrameCallbackHandle
    pump.requestVideoFrameCallbackHandle = undefined
    if (callbackHandle !== undefined) cancelVideoFrameCallback(callbackHandle)

    if (pump.fallbackTimerId !== undefined) {
      clearTimeout(pump.fallbackTimerId)
      pump.fallbackTimerId = undefined
    }
  }

  function beginFrameRecovery(error: unknown): void {
    if (!isActiveAttempt(attempt)) return
    attempt.frameRecoveryActive = true
    attempt.lastFrameErrorName = diagnosticName(error)
    attempt.lastErrorName = attempt.lastFrameErrorName
    publishPipelineDiagnostic(attempt)
    ensureFrameReadyTimeout()
    retryVideoPlayback(attempt)
  }

  function takeScheduledFrame(
    source: "video" | "timer",
    nextDecodeDeadline: number,
  ): void {
    if (source === "video") {
      pump.requestVideoFrameCallbackHandle = undefined
      if (pump.fallbackTimerId !== undefined) {
        clearTimeout(pump.fallbackTimerId)
        pump.fallbackTimerId = undefined
      }
    } else {
      pump.fallbackTimerId = undefined
      const callbackHandle = pump.requestVideoFrameCallbackHandle
      pump.requestVideoFrameCallbackHandle = undefined
      if (callbackHandle !== undefined) cancelVideoFrameCallback(callbackHandle)
    }

    if (
      pump.cancelled ||
      pump.decodeInFlight ||
      !isActiveAttempt(attempt)
    ) {
      return
    }

    if (Date.now() < nextDecodeDeadline) {
      scheduleNextFrame(nextDecodeDeadline)
      return
    }

    pump.decodeInFlight = true
    void decodeFrame()
  }

  function armFrameRace(
    nextDecodeDeadline: number,
    callbackFallbackDelayMs = 0,
  ): void {
    if (
      pump.cancelled ||
      pump.decodeInFlight ||
      !isActiveAttempt(attempt) ||
      pump.requestVideoFrameCallbackHandle !== undefined ||
      pump.fallbackTimerId !== undefined
    ) {
      return
    }

    // Early video callbacks re-arm with this unchanged absolute deadline. The timer
    // targets the same deadline, so a silent callback cannot add a second wait.
    let callbackRegistered = false
    let callbackFiredSynchronously = false
    let callbackRegistrationComplete = false
    const requestVideoFrameCallback = attempt.video.requestVideoFrameCallback
    if (typeof requestVideoFrameCallback === "function") {
      try {
        const callbackHandle = requestVideoFrameCallback.call(attempt.video, () => {
          if (!callbackRegistrationComplete) {
            callbackFiredSynchronously = true
            return
          }
          takeScheduledFrame("video", nextDecodeDeadline)
        })
        callbackRegistrationComplete = true
        if (!callbackFiredSynchronously) {
          pump.requestVideoFrameCallbackHandle = callbackHandle
          callbackRegistered = true
        } else if (Date.now() >= nextDecodeDeadline) {
          takeScheduledFrame("video", nextDecodeDeadline)
        }
      } catch {
        callbackRegistrationComplete = true
        // Fall through to the timer scheduler when rVFC is unavailable at runtime.
      }
    }

    if (
      pump.cancelled ||
      pump.decodeInFlight ||
      !isActiveAttempt(attempt)
    ) {
      return
    }

    pump.fallbackTimerId = setTimeout(
      () => takeScheduledFrame("timer", nextDecodeDeadline),
      Math.max(
        0,
        nextDecodeDeadline - Date.now(),
        callbackRegistered ? callbackFallbackDelayMs : 0,
      ),
    )
  }

  function scheduleNextFrame(
    nextDecodeDeadline = Date.now(),
    replaceScheduled = false,
    callbackFallbackDelayMs = 0,
  ): void {
    if (pump.cancelled || pump.decodeInFlight || !isActiveAttempt(attempt)) return

    if (
      pump.requestVideoFrameCallbackHandle !== undefined ||
      pump.fallbackTimerId !== undefined
    ) {
      if (!replaceScheduled) return
      cancelScheduledFrame()
    }

    armFrameRace(nextDecodeDeadline, callbackFallbackDelayMs)
  }

  async function decodeFrame(): Promise<void> {
    let decodeStartedAt: number | undefined
    let decodeCallStarted = false
    let decodeCallCompleted = false
    try {
      if (!isActiveAttempt(attempt)) return

      const sourceWidth = videoDimension(attempt.video.videoWidth)
      const sourceHeight = videoDimension(attempt.video.videoHeight)
      if (sourceWidth === 0 || sourceHeight === 0) {
        throw new DOMException("Camera frame has no dimensions", "IndexSizeError")
      }
      if (cameraTrack(attempt)?.muted === true) {
        throw new DOMException("Camera frame is muted", "InvalidStateError")
      }

      const dimensions = scaledFrameDimensions(sourceWidth, sourceHeight)
      if (canvas.width !== dimensions.width) canvas.width = dimensions.width
      if (canvas.height !== dimensions.height) canvas.height = dimensions.height

      if (!isActiveAttempt(attempt)) return
      frameContext.drawImage(attempt.video, 0, 0, dimensions.width, dimensions.height)
      attempt.videoFramesDrawn += 1
      // A successful draw proves scheduling progress and starts a fresh decode window.
      // The shorter reader-preparation bound will still identify a hung module first.
      armDecodeProgressWatchdog()
      publishPipelineDiagnostic(attempt)
      clearFrameRecovery()

      const imageData = frameContext.getImageData(
        0,
        0,
        dimensions.width,
        dimensions.height,
      )
      if (!isActiveAttempt(attempt)) return

      if (!(await webAssemblyRuntimeSupport)) {
        throw new ConcreteAppError("QR_READER_BLOCKED")
      }
      if (!isActiveAttempt(attempt)) return

      // Reader preparation remains after the first real draw so camera acquisition is
      // never blocked on WASM, but unlike frame readiness it has its own bounded wait.
      await waitForReaderModulePreparation()
      if (!isActiveAttempt(attempt)) return

      decodeStartedAt = Date.now()
      decodeCallStarted = true
      const results = await readBarcodes(imageData, zxingReaderOptions)
      if (!isActiveAttempt(attempt)) return
      decodeCallCompleted = true
      completeDecodeAttempt(results.length)

      const result = results[0]
      if (result === undefined) return
      if (!isActiveAttempt(attempt) || (once && attempt.emitted)) return

      const text = result.text
      if (!isActiveAttempt(attempt)) return
      attempt.emitted = true
      if (once) handle.stop()
      onText(text)
    } catch (error) {
      if (!isActiveAttempt(attempt)) return
      if (decodeCallStarted && !decodeCallCompleted) {
        completeDecodeAttempt(0)
      }
      if (isFrameNotReadyDecodeError(attempt, error)) {
        beginFrameRecovery(error)
        return
      }
      failDecode(error)
    } finally {
      pump.decodeInFlight = false
      if (!pump.cancelled && isActiveAttempt(attempt)) {
        if (decodeStartedAt === undefined) {
          if (isActiveAttempt(attempt)) {
            scheduleNextFrame(Date.now() + frameRetryDelayMs)
          }
        } else {
          if (isActiveAttempt(attempt)) {
            scheduleNextFrame(decodeStartedAt + decodeIntervalMs)
          }
        }
      }
    }
  }

  attempt.controls = pump
  attempt.decodePumpStarted = true
  armDecodeProgressWatchdog()
  attempt.phase = "playing"
  attempt.frameRecoveryActive = true
  attempt.lastFrameErrorName = undefined
  ensureFrameReadyTimeout()
  attempt.retryDecoder = () => scheduleNextFrame(Date.now(), true)
  // Preserve the initial rVFC grace period; the readiness watchdog is already armed.
  // Steady-state scheduling above uses the cadence deadline with no added grace.
  scheduleNextFrame(Date.now(), false, frameRetryDelayMs)
  retryVideoPlayback(attempt)
  return pump
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
    onDiagnostic: options?.onDiagnostic,
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
    decodeProgressTimeoutId: undefined,
    frameRecoveryActive: false,
    decodePumpStarted: false,
    readerModuleState: "idle",
    videoFramesDrawn: 0,
    decodeAttemptsCompleted: 0,
    decodeResultsSeen: 0,
    lastErrorName: null,
    lastFrameErrorName: undefined,
    retryDecoder: undefined,
    cancelModulePreparationWait: undefined,
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

  if (!isActiveAttempt(attempt)) {
    throw attempt.failure ?? new ConcreteAppError("CAMERA_NOT_AVAILABLE")
  }

  // Neither promise is awaited: getUserMedia has to run inside the tap's
  // user-activation window. The decoder awaits both only after its first drawn frame,
  // with a bounded wait for reader preparation.
  const modulePreparation = prepareQrReaderModule()
  attempt.readerModuleState = zxingModuleState
  publishPipelineDiagnostic(attempt)
  const webAssemblyRuntimeSupport = probeWebAssemblyRuntime()

  const operation: Promise<AttemptOutcome> = startAttempt(
    attempt,
    handle,
    onText,
    options?.once ?? true,
    modulePreparation,
    webAssemblyRuntimeSupport,
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
      // Once the pump owns a decode-progress watchdog, let its distinct diagnostic
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
