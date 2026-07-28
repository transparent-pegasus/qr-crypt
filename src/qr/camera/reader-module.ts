import {
  prepareZXingModule,
  purgeZXingModule,
  type ReaderOptions,
  type ZXingModuleOverrides,
} from "zxing-wasm/reader"
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"

import { hasWebAssemblyInstantiationApi } from "@/lib/feature-detect"
import { currentAttempt } from "@/qr/camera/attempt-registry"
import type { CameraAttempt, ReaderModuleState } from "@/qr/camera/types"

export const CAMERA_START_TIMEOUT_MS = 8_000
export const CAMERA_FRAME_READY_TIMEOUT_MS = 6_000
// A first compile that shares a phone with a starting 1080p capture can run past
// any budget worth setting mid-decode, so the wait moved to the gate. It stays
// bounded: a preparation that never settles must still reach a terminal state.
export const CAMERA_READER_READY_TIMEOUT_MS = 30_000
// Two frame-readiness windows remain far beyond the healthy 200 ms empty-decode
// cadence while bounding a readBarcodes call that never settles.
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

export class QrDecodeProgressTimeout extends Error {
  constructor() {
    super("QR decoding made no progress")
    this.name = "QrDecodeProgressTimeout"
  }
}

export function readerModuleState(): ReaderModuleState {
  return zxingModuleState
}

// Start or reuse WASM preparation. The shared readiness gate awaits this before
// enabling capture; startQrScan also calls it to ensure direct callers install the
// bundled same-origin locateFile override before readBarcodes runs.
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
    zxingModuleState = "ready"
    const attempt = currentAttempt()
    if (attempt !== null) publishPipelineDiagnostic(attempt, zxingModuleState)
  })
  zxingModulePromise = preparation
  // Latch the failure for this document and swallow the rejection here: the seeding
  // call in startQrScan deliberately does not await it. Cleanup runs to completion
  // before the diagnostic so callbacks observe the terminal generation.
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

// Fetch and compile the reader ahead of any tap. The readiness gate awaits the returned
// promise and presents a latched failure instead of starting another generation in-page.
export function warmQrReaderModule(
  publishPipelineDiagnostic: PipelineDiagnosticPublisher,
): Promise<void> {
  return prepareQrReaderModule(publishPipelineDiagnostic)
}
