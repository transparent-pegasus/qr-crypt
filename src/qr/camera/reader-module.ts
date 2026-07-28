import {
  prepareZXingModule,
  purgeZXingModule,
  type ReaderOptions,
  type ZXingModuleOverrides,
} from "zxing-wasm/reader"
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"

import { hasWebAssemblyInstantiationApi } from "@/lib/feature-detect"
import {
  currentAttempt,
  isActiveAttempt,
} from "@/qr/camera/attempt-registry"
import { AttemptCancelled } from "@/qr/camera/types"
import type {
  CameraAttempt,
  ReaderModuleState,
  ScanContext,
} from "@/qr/camera/types"

export const CAMERA_START_TIMEOUT_MS = 8_000
export const CAMERA_FRAME_READY_TIMEOUT_MS = 6_000
// A first compile that shares a phone with a starting 1080p capture can run past
// any budget worth setting mid-decode, so the wait moved to the gate. It stays
// bounded: a preparation that never settles must still reach a terminal state.
export const CAMERA_READER_READY_TIMEOUT_MS = 30_000
// A cached one-megabyte reader should fetch and compile within the same eight-second
// budget as camera startup. Bounding it here prevents a successful first draw from
// clearing the frame-readiness watchdog and then waiting on WebKit forever.
export const CAMERA_READER_PREPARATION_TIMEOUT_MS = CAMERA_START_TIMEOUT_MS
// Two frame-readiness windows leave the reader timeout above time to identify itself
// first, while remaining far beyond the healthy 200 ms empty-decode cadence.
export const CAMERA_DECODE_PROGRESS_TIMEOUT_MS = CAMERA_FRAME_READY_TIMEOUT_MS * 2

export type PipelineDiagnosticPublisher = (
  attempt: CameraAttempt,
  readerModuleState?: ReaderModuleState,
) => void

const zxingModuleOverrides: ZXingModuleOverrides = {
  locateFile(path: string, scriptDirectory: string) {
    return path.endsWith(".wasm") ? wasmUrl : scriptDirectory + path
  },
}

export const zxingReaderOptions: ReaderOptions = {
  formats: ["QRCodeModel2"],
  returnErrors: false,
  maxNumberOfSymbols: 1,
  tryInvert: true,
  tryRotate: true,
  tryHarder: true,
  tryDownscale: true,
}

let zxingModulePromise: Promise<void> | undefined
let zxingModuleFailure: Promise<void> | undefined
let zxingModuleState: ReaderModuleState = "idle"

export class QrReaderPreparationTimeout extends Error {
  constructor() {
    super("QR reader preparation timed out")
    this.name = "QrReaderPreparationTimeout"
  }
}

export class QrDecodeProgressTimeout extends Error {
  constructor() {
    super("QR decoding made no progress")
    this.name = "QrDecodeProgressTimeout"
  }
}

export function readerModuleState(): ReaderModuleState {
  return zxingModuleState
}

// Start (or reuse) WASM preparation WITHOUT awaiting it. iOS Safari only opens the
// camera permission prompt while the user activation from the tap is still live, and
// fetching plus compiling a one-megabyte binary outlives that window. Acquisition must
// therefore reach getUserMedia first; the decoder awaits this promise later, after the
// first frame has been drawn.
export function prepareQrReaderModule(
  publishPipelineDiagnostic: PipelineDiagnosticPublisher,
): Promise<void> {
  // Latched for the life of the document: the reported failure mode does not
  // recover in-page, and re-preparing only produces a second stalled generation.
  if (zxingModuleFailure !== undefined) return zxingModuleFailure

  const existing = zxingModulePromise
  if (existing !== undefined) return existing

  if (!hasWebAssemblyInstantiationApi()) {
    zxingModuleState = "failed"
    const unsupported = Promise.reject(
      new Error("WebAssembly is unavailable for the QR reader"),
    )
    zxingModuleFailure = unsupported
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
    zxingModuleFailure = rejected
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
    const attempt = currentAttempt()
    if (attempt !== null) publishPipelineDiagnostic(attempt, zxingModuleState)
  })
  zxingModulePromise = preparation
  // Reset on failure so the restart button can retry, and swallow the rejection here:
  // an attempt can stop before any decode awaits this promise. Cleanup runs to
  // completion before the diagnostic, because a synchronous callback can start a fresh
  // preparation and must not have it purged from under it.
  void preparation.catch(() => {
    if (zxingModulePromise !== preparation) return
    zxingModuleFailure = preparation
    zxingModulePromise = undefined
    zxingModuleState = "failed"
    purgeZXingModule()
    const attempt = currentAttempt()
    if (attempt !== null) publishPipelineDiagnostic(attempt, zxingModuleState)
  })
  return preparation
}

// Tear down only the generation that actually failed. If a newer preparation is already
// cached — started by a diagnostic callback, a warm-up, or another attempt — leave it
// alone so the retry adopts it instead of erasing it.
function invalidateQrReaderModule(failed: Promise<void>): void {
  if (zxingModulePromise !== undefined && zxingModulePromise !== failed) return
  zxingModulePromise = undefined
  zxingModuleState =
    zxingModuleFailure === undefined ? "idle" : "failed"
  purgeZXingModule()
}

// Fetch and compile the reader ahead of any tap. The readiness gate awaits the returned
// promise and presents a latched failure instead of starting another generation in-page.
export function warmQrReaderModule(
  publishPipelineDiagnostic: PipelineDiagnosticPublisher,
): Promise<void> {
  return prepareQrReaderModule(publishPipelineDiagnostic)
}

export async function waitForReaderModulePreparation(
  context: ScanContext,
  publishPipelineDiagnostic: PipelineDiagnosticPublisher,
  diagnosticName: (error: unknown) => string,
  onPreparationRetry: () => void,
): Promise<void> {
  const { attempt } = context

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

  if (attempt.readerModuleState === "ready" || zxingModuleState === "ready") {
    attempt.lastPreparationError = undefined
    attempt.readerModuleState = "ready"
    publishPipelineDiagnostic(attempt)
    return
  }

  let preparation = context.modulePreparation
  for (;;) {
    try {
      await awaitPreparation(preparation)
      attempt.lastPreparationError = undefined
      attempt.readerModuleState = "ready"
      publishPipelineDiagnostic(attempt)
      return
    } catch (error) {
      // A cancelled attempt is being torn down and must not restart anything.
      // A timeout is now retried like any other failure: a stall and an Emscripten
      // abort are two transient failures of the same preparation operation, and making
      // recovery depend on which settlement shape WebKit produces is an unhelpful
      // asymmetry. Both spend the single retry.
      const retryable =
        !context.readerRetryUsed &&
        !(error instanceof AttemptCancelled) &&
        isActiveAttempt(attempt)
      if (!retryable) {
        if (!(error instanceof AttemptCancelled) && isActiveAttempt(attempt)) {
          attempt.lastPreparationError = error
          attempt.readerModuleState =
            error instanceof QrReaderPreparationTimeout ? "timed-out" : "failed"
          attempt.lastErrorName = diagnosticName(error)
          publishPipelineDiagnostic(attempt)
        }
        throw error
      }
      context.readerRetryUsed = true
      attempt.lastErrorName = diagnosticName(error)
      invalidateQrReaderModule(preparation)
      preparation = prepareQrReaderModule(publishPipelineDiagnostic)
      // The decode-progress watchdog was armed by the first drawn frame and would
      // otherwise expire mid-retry, ending the attempt with the wrong error and
      // cutting the second window to ~4 s. Starting a fresh generation is progress.
      onPreparationRetry()
      // pipelineDiagnostic only mirrors the module state while the attempt field is
      // idle or preparing, so publishing before this assignment would latch "failed"
      // for the whole retry window.
      attempt.readerModuleState = "preparing"
      publishPipelineDiagnostic(attempt)
    }
  }
}
