// QR の PNG/SVG/テキスト出力とダウンロード(spec §13/§14)。
// ファイル名に秘密情報・平文・鍵素材を含めない。
import type { QrEcLevel } from "@/schemas/domain"

export interface QrExportOptions {
  ecLevel: QrEcLevel
  size: number
}

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function qrPngBlob(
  payload: string,
  options: QrExportOptions,
): Promise<Blob> {
  return notImplemented(payload, options)
}

export function qrSvgBlob(
  payload: string,
  options: Pick<QrExportOptions, "ecLevel">,
): Promise<Blob> {
  return notImplemented(payload, options)
}

// 制御文字と / \ : * ? " < > | を除去、trim、空なら "qr"、80 文字で切詰
export function sanitizeQrFileName(name: string): string {
  return notImplemented(name)
}

// `<sanitized-name>-<shortId>.<ext>`
export function buildExportFileName(
  name: string,
  id: string,
  ext: "png" | "svg" | "txt",
): string {
  return notImplemented(name, id, ext)
}

export function triggerDownload(blob: Blob, fileName: string): void {
  notImplemented(blob, fileName)
}

export function copyTextToClipboard(text: string): Promise<void> {
  return notImplemented(text)
}
