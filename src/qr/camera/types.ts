import type { AppError } from "@/crypto/errors"

export interface QrScanHandle {
  // Idempotent. Stop controls and every MediaStreamTrack owned by this attempt.
  stop(): void
}

export type ReaderModuleState = "idle" | "preparing" | "ready" | "failed"

export interface StartQrScanOptions {
  // Defaults to true: stop automatically after the first success and ignore later
  // detections to prevent duplicate reads.
  once?: boolean
  signal?: AbortSignal
}

export type CameraFailureState = "failed" | "track-ended"

export type CameraScanState =
  | "idle"
  | "acquiring"
  | "playing"
  | CameraFailureState

export interface ScannerControls {
  stop(): void
}

export interface ScannerPump extends ScannerControls {
  requestVideoFrameCallbackHandle: number | undefined
  fallbackTimerId: ReturnType<typeof setTimeout> | undefined
  decodeInFlight: boolean
  cancelled: boolean
}

export interface ScanContext {
  attempt: CameraAttempt
  pump: ScannerPump
  canvas: HTMLCanvasElement
  frameContext: CanvasRenderingContext2D
  once: boolean
  handle: QrScanHandle
  onText(text: string): void
}

export interface CameraAttempt {
  readonly id: number
  readonly video: HTMLVideoElement
  readonly onError: (error: AppError, failureState: CameraFailureState) => void
  readonly stoppedPromise: Promise<void>
  resolveStopped(): void
  stopped: boolean
  emitted: boolean
  errorReported: boolean
  controls: ScannerControls | undefined
  stream: MediaStream | undefined
  failure: AppError | undefined
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
  retryDecoder: (() => void) | undefined
  abortSignal: AbortSignal | undefined
  abortListener: EventListener | undefined
}

export class AttemptCancelled extends Error {}
