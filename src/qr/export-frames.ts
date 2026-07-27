// Frame-set export, one module away from export-image so qrPngBlob and triggerDownload
// are import-seam dependencies a test can substitute.
import { storeOnlyZip } from "@/lib/best-effort-zip"
import { qrPngBlob, sanitizeQrFileName, triggerDownload } from "@/qr/export-image"

export interface QrFrameExportEntry {
  // Protocol frame index, zero-based. Zip entry names come from it, not from the array
  // position, so a gap in the available set keeps the remaining frames' real numbers.
  frameIndex: number
  payload: string
}

export interface QrFrameExportOptions {
  outputName: string
  size: number
  signal?: AbortSignal
}

// One frame is a bare png; several are a store-only zip. Aborts are checked between every
// await because a density change can retire the frame set mid-export.
export async function exportQrFramePayloads(
  frames: readonly QrFrameExportEntry[],
  { outputName, size, signal }: QrFrameExportOptions,
): Promise<void> {
  if (frames.length === 0) return
  if (signal?.aborted) return
  const safeName = sanitizeQrFileName(outputName)

  if (frames.length === 1) {
    const blob = await qrPngBlob(frames[0]!.payload, { ecLevel: "Q", size })
    if (signal?.aborted) return
    triggerDownload(blob, `${safeName}.png`)
    return
  }

  const entries: Array<{ name: string; data: Uint8Array }> = []
  for (const frame of frames) {
    if (signal?.aborted) return
    const blob = await qrPngBlob(frame.payload, { ecLevel: "Q", size })
    if (signal?.aborted) return
    const data = new Uint8Array(await blob.arrayBuffer())
    if (signal?.aborted) return
    entries.push({
      name: `frame-${String(frame.frameIndex + 1).padStart(2, "0")}.png`,
      data,
    })
  }
  if (signal?.aborted) return
  triggerDownload(storeOnlyZip(entries), `${safeName}-frames.zip`)
}
