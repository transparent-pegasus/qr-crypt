import { AppError as ConcreteAppError } from "@/crypto/errors"
import type { CameraAttempt } from "@/qr/camera/types"

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
