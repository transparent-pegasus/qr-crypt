// カメラ QR 読取(spec §16 / plan §12-10, §13 C10)。
// @zxing/browser の import は本モジュールに限定する(テストは @zxing/library)。
import type { AppError } from "@/crypto/errors"
import { BrowserQRCodeReader } from "@zxing/browser"
import { AppError as ConcreteAppError } from "@/crypto/errors"

export interface QrScanHandle {
  // 冪等。controls 停止と全 MediaStreamTrack 停止まで保証する
  stop(): void
}

export interface StartQrScanOptions {
  // 既定 true: 初回成功で自動停止し、以後の検出を無視する(多重読取防止)
  once?: boolean
  signal?: AbortSignal
}

function cameraError(error: unknown): ConcreteAppError {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : ""
  return new ConcreteAppError(
    name === "NotAllowedError" ? "CAMERA_PERMISSION_DENIED" : "CAMERA_NOT_AVAILABLE",
  )
}

function isTransientCameraAcquireError(error: unknown): boolean {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : ""
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

// NotFoundException(未検出)はスキャン継続。初回カメラ取得時の一時エラーだけ再試行。
// callback の fatal は再試行せず onError:
// NotAllowedError → CAMERA_PERMISSION_DENIED / NotFoundError・NotReadableError → CAMERA_NOT_AVAILABLE
export async function startQrScan(
  video: HTMLVideoElement,
  onText: (text: string) => void,
  onError: (error: AppError) => void,
  options?: StartQrScanOptions,
): Promise<QrScanHandle> {
  const reader = new BrowserQRCodeReader()
  const once = options?.once ?? true
  let stopped = false
  let emitted = false
  const signal = options?.signal
  let controls: { stop(): void } | undefined
  // ponytail: camera handoff recovery is capped at 3 retries × 300 ms.
  const maxAcquireRetries = 3
  const acquireRetryDelayMs = 300

  const stopTracks = () => {
    const stream = video.srcObject
    if (stream instanceof MediaStream) {
      for (const track of stream.getTracks()) track.stop()
      video.srcObject = null
    }
  }
  const handle: QrScanHandle = {
    stop() {
      if (stopped) return
      stopped = true
      controls?.stop()
      stopTracks()
    },
  }

  try {
    let retries = 0
    while (true) {
      try {
        controls = await reader.decodeFromVideoDevice(
          undefined,
          video,
          (result, error, callbackControls) => {
            controls = callbackControls
            if (stopped) return
            if (result !== undefined) {
              if (once && emitted) return
              emitted = true
              const text = result.getText()
              if (once) handle.stop()
              onText(text)
              return
            }
            if (error !== undefined && !isTransientDecodeError(error)) {
              const mapped = cameraError(error)
              handle.stop()
              onError(mapped)
            }
          },
        )
        break
      } catch (error) {
        if (!isTransientCameraAcquireError(error) || retries >= maxAcquireRetries) {
          throw error
        }
        stopTracks()
        if (stopped || signal?.aborted) throw error
        retries += 1
        await new Promise<void>((resolve) => {
          setTimeout(resolve, acquireRetryDelayMs)
        })
        if (stopped || signal?.aborted) throw error
      }
    }
    if (stopped) {
      controls.stop()
      stopTracks()
    }
    return handle
  } catch (error) {
    handle.stop()
    const mapped = cameraError(error)
    onError(mapped)
    throw mapped
  }
}
