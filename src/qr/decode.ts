// カメラ QR 読取(spec §16 / plan §12-10, §13 C10)。
// @zxing/browser の import は本モジュールに限定する(テストは @zxing/library)。
import type { AppError } from "@/crypto/errors"

export interface QrScanHandle {
  // 冪等。controls 停止と全 MediaStreamTrack 停止まで保証する
  stop(): void
}

export interface StartQrScanOptions {
  // 既定 true: 初回成功で自動停止し、以後の検出を無視する(多重読取防止)
  once?: boolean
}

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// NotFoundException(未検出)はスキャン継続。fatal のみ onError:
// NotAllowedError → CAMERA_PERMISSION_DENIED / NotFoundError・NotReadableError → CAMERA_NOT_AVAILABLE
export function startQrScan(
  video: HTMLVideoElement,
  onText: (text: string) => void,
  onError: (error: AppError) => void,
  options?: StartQrScanOptions,
): Promise<QrScanHandle> {
  return notImplemented(video, onText, onError, options)
}
