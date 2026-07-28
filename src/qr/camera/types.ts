import type { AppError } from "@/crypto/errors"

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

export type CameraDiagnosticPhase =
  | "acquiring"
  | "acquired"
  | "playing"
  | "track-ended"

export interface CameraDiagnostic {
  phase: CameraDiagnosticPhase
  name: string | null
  detail: string
  message: string | null
}

export type CameraScanState =
  | "idle"
  | "acquiring"
  | "playing"
  | "failed"
  | "track-ended"

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
  modulePreparation: Promise<void>
  webAssemblyRuntimeSupport: Promise<boolean>
  readerRetryUsed: boolean
}

export interface CameraAttempt {
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
  readerModuleState: ReaderModuleState
  videoFramesDrawn: number
  decodeAttemptsCompleted: number
  decodeResultsSeen: number
  lastErrorName: string | null
  lastFrameErrorName: string | undefined
  lastPreparationError: unknown | undefined
  retryDecoder: (() => void) | undefined
  cancelModulePreparationWait: (() => void) | undefined
  abortSignal: AbortSignal | undefined
  abortListener: EventListener | undefined
}

export class AttemptCancelled extends Error {}
