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
): CameraDiagnostic {
  return {
    phase,
    name,
    detail: diagnosticDetail(attempt),
  }
}

export function cameraError(error: unknown): ConcreteAppError {
  if (error instanceof ConcreteAppError) return error

  const name = diagnosticName(error)
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
