import { AppError as ConcreteAppError } from "@/crypto/errors"
import { isActiveAttempt } from "@/qr/camera/attempt-registry"
import type {
  CameraAttempt,
  CameraDiagnostic,
  CameraDiagnosticPhase,
  CameraPipelineDiagnostic,
  ReaderModuleState,
} from "@/qr/camera/types"

const CAMERA_DIAGNOSTIC_NAME = /^[A-Za-z]{1,40}$/
const CAMERA_DIAGNOSTIC_MESSAGE_MAX = 200

export function diagnosticName(error: unknown): string {
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

// Bounded, printable-ASCII only. Fed exclusively from reader-preparation failures — never
// from decode, delivery or acquisition errors, whose surrounding try block also covers the
// scanned payload and the caller's onText callback.
function diagnosticMessage(error: unknown): string | null {
  try {
    if (typeof error !== "object" || error === null) return null
    const raw = Reflect.get(error, "message") as unknown
    if (typeof raw !== "string" || raw.length === 0) return null
    // Bound the input first: a hostile or runaway message must not cost a full scan.
    const cleaned = raw
      .slice(0, CAMERA_DIAGNOSTIC_MESSAGE_MAX * 2)
      .replace(/[^ -~]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    return cleaned.length === 0
      ? null
      : cleaned.slice(0, CAMERA_DIAGNOSTIC_MESSAGE_MAX)
  } catch {
    return null
  }
}

export function cameraTrack(attempt: CameraAttempt): MediaStreamTrack | undefined {
  const tracks = attempt.stream?.getTracks() ?? []
  return tracks.find((track) => track.kind === "video") ?? tracks[0]
}

export function videoDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
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

function pipelineDiagnostic(
  attempt: CameraAttempt,
  readerModuleState: ReaderModuleState,
): CameraPipelineDiagnostic {
  if (
    (attempt.readerModuleState === "idle" ||
      attempt.readerModuleState === "preparing") &&
    readerModuleState !== "idle"
  ) {
    attempt.readerModuleState = readerModuleState
  }
  return {
    readerModuleState: attempt.readerModuleState,
    videoFramesDrawn: attempt.videoFramesDrawn,
    decodeAttemptsCompleted: attempt.decodeAttemptsCompleted,
    decodeResultsSeen: attempt.decodeResultsSeen,
    lastErrorName: attempt.lastErrorName,
  }
}

export function publishPipelineDiagnostic(
  attempt: CameraAttempt,
  readerModuleState: ReaderModuleState = attempt.readerModuleState,
): void {
  if (!isActiveAttempt(attempt) || attempt.onDiagnostic === undefined) return
  try {
    attempt.onDiagnostic(pipelineDiagnostic(attempt, readerModuleState))
  } catch {
    // Diagnostics must never become another scanner failure path.
  }
}

export function cameraDiagnostic(
  attempt: CameraAttempt,
  name: string | null,
  phase: CameraDiagnosticPhase = attempt.phase,
  preparationError?: unknown,
): CameraDiagnostic {
  return {
    phase,
    name,
    detail: diagnosticDetail(attempt),
    message:
      preparationError === undefined ? null : diagnosticMessage(preparationError),
  }
}

export function cameraError(error: unknown): ConcreteAppError {
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

export function isTransientCameraAcquireError(error: unknown): boolean {
  const name = diagnosticName(error)
  return name === "NotReadableError" || name === "AbortError"
}

export function isFrameNotReadyDecodeError(
  attempt: CameraAttempt,
  error: unknown,
): boolean {
  if (cameraTrack(attempt)?.readyState !== "live") return false
  const name = diagnosticName(error)
  return name === "IndexSizeError" || name === "InvalidStateError"
}
