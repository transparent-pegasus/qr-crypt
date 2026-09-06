import { vi } from "vitest"
import { AppError } from "@/crypto/errors"
import { registerFakeReset } from "./reset"

type FakeCameraFailureState = "failed" | "track-ended"

export const scannerStop = vi.fn()
export const readerModuleState = vi.fn<
  () => "idle" | "preparing" | "ready" | "failed"
>(() => "ready")
export const warmQrReader = vi.fn<() => Promise<void>>(() => Promise.resolve())
let scanTextCallback: ((payload: string) => void) | null = null
export const startQrScan = vi.fn(
  async (
    _video: HTMLVideoElement,
    onText: (payload: string) => void,
    _onError: (error: AppError, failureState: FakeCameraFailureState) => void,
    _options?: {
      once?: boolean
      signal?: AbortSignal
    },
  ): Promise<{ stop: () => void }> => {
    void _options
    scanTextCallback = onText
    return { stop: scannerStop }
  },
)

export function emitScannedPayload(payload: string): void {
  scanTextCallback?.(payload)
}

registerFakeReset(() => {
  scanTextCallback = null
  readerModuleState.mockImplementation(() => "ready")
  warmQrReader.mockImplementation(() => Promise.resolve())
})
