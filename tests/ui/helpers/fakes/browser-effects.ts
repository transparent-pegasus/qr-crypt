import { vi } from "vitest"
import type { QrExportOptions } from "@/qr/export-image"

export const qrPngBlob = vi.fn<
  (payload: string, options: QrExportOptions) => Promise<Blob>
>(async () => new Blob(["png"]))
export const qrSvgBlob = vi.fn(async () => new Blob(["svg"]))
export const triggerDownload = vi.fn()
export const copyTextToClipboard = vi.fn(async () => undefined)
export const copyImageToClipboard = vi.fn(async () => undefined)
