// カメラ QR 読取(spec §16 / plan §12-10, §13 C10)。
// @zxing/browser の import は本モジュールに限定する(テストは @zxing/library)。
import type { AppError } from "@/crypto/errors"
import { BrowserQRCodeReader } from "@zxing/browser"
import { AppError as ConcreteAppError } from "@/crypto/errors"

export interface QrScanHandle {
  // 冪等。controls 停止と、この試行が所有する全 MediaStreamTrack 停止まで保証する
  stop(): void
}

export interface StartQrScanOptions {
  // 既定 true: 初回成功で自動停止し、以後の検出を無視する(多重読取防止)
  once?: boolean
  signal?: AbortSignal
}

export type CameraDiagnosticPhase = "acquiring" | "acquired" | "playing" | "track-ended"

export interface CameraDiagnostic {
  phase: CameraDiagnosticPhase
  name: string | null
}

export type CameraScanState = "idle" | "acquiring" | "playing" | "failed" | "track-ended"

export const CAMERA_START_TIMEOUT_MS = 8_000

const CAMERA_ERROR_NAMES = new Set([
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OverconstrainedError",
  "AbortError",
  "SecurityError",
])

const maxAcquireRetries = 3
const acquireRetryDelayMs = 300

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
}

class AttemptCancelled extends Error {}

let nextAttemptId = 0
let activeAttempt: CameraAttempt | null = null

// getUserMedia 自体は中断できないため、未解決の取得を追い越さない直列キューにする。
let cameraAcquisitionQueue: Promise<void> = Promise.resolve()

export function shouldRestartQrScanOnVisibility(
  state: CameraScanState,
  visibilityState: DocumentVisibilityState,
): boolean {
  return (
    visibilityState === "visible" && (state === "failed" || state === "track-ended")
  )
}

function diagnosticName(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : ""
  return CAMERA_ERROR_NAMES.has(name) ? name : "unknown"
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

function isTransientDecodeError(error: unknown): boolean {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : ""
  return (
    name === "NotFoundException" ||
    name === "ChecksumException" ||
    name === "FormatException"
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
    // controls が失敗しても、所有トラックの停止を継続する
  }
}

function stopAttempt(attempt: CameraAttempt): void {
  if (attempt.stopped) return
  attempt.stopped = true
  attempt.resolveStopped()

  for (const { track, listener } of attempt.endedListeners) {
    track.removeEventListener("ended", listener)
  }
  attempt.endedListeners = []

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

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    })
    if (!isActiveAttempt(attempt)) {
      stopStream(stream, attempt.video)
      throw new AttemptCancelled()
    }
    return stream
  })

  // 失敗もキューを壊さない。取得 Promise が実際に settle するまでは次を開始しない。
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
    reportAttemptError(attempt, error, { phase: "track-ended", name: null })
    stopAttempt(attempt)
  }

  for (const track of stream.getTracks()) {
    track.addEventListener("ended", onEnded)
    attempt.endedListeners.push({ track, listener: onEnded })
  }

  if (stream.getTracks().some((track) => track.readyState === "ended")) onEnded(new Event("ended"))
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

  const controls = await reader.decodeFromVideoElement(
    attempt.video,
    (result, error, callbackControls) => {
      if (!isActiveAttempt(attempt)) {
        stopControlsOnce(attempt, callbackControls)
        return
      }
      attempt.controls = callbackControls
      attempt.phase = "playing"

      if (result !== undefined) {
        if (once && attempt.emitted) return
        attempt.emitted = true
        const text = result.getText()
        if (once) handle.stop()
        onText(text)
        return
      }

      if (error !== undefined && !isTransientDecodeError(error)) {
        const mapped = cameraError(error)
        reportAttemptError(attempt, mapped, {
          phase: "playing",
          name: diagnosticName(error),
        })
        stopAttempt(attempt)
      }
    },
  )

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

// NotFoundException(未検出)はスキャン継続。初回カメラ取得時の一時エラーだけ再試行。
// 取得・再生・停止は世代 ID と試行所有ストリームで分離し、旧世代は UI 状態を触らない。
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
  }
  activeAttempt = attempt

  const handle: QrScanHandle = {
    stop() {
      stopAttempt(attempt)
    },
  }

  const signal = options?.signal
  const onAbort = () => stopAttempt(attempt)
  signal?.addEventListener("abort", onAbort, { once: true })
  if (signal?.aborted) onAbort()

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
      reportAttemptError(attempt, mapped, {
        phase: attempt.phase,
        name: "unknown",
      })
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
    reportAttemptError(attempt, mapped, {
      phase: attempt.phase,
      name: diagnosticName(outcome.error),
    })
    stopAttempt(attempt)
    throw mapped
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    signal?.removeEventListener("abort", onAbort)
  }
}

export const startQrScan = Object.assign(startQrScanImplementation, {
  shouldRestartOnVisibility: shouldRestartQrScanOnVisibility,
})
