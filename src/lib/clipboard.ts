// Clipboard writes, mapped to the storage failure domain.
import { toAppError } from "@/crypto/errors"
import { fromStandardBase64 } from "@/lib/base64url"

export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function copyImageToClipboard(pngDataUrl: string): Promise<void> {
  try {
    const bytes = fromStandardBase64(pngDataUrl.slice(pngDataUrl.indexOf(",") + 1))
    const blob = new Blob([bytes.slice()], { type: "image/png" })
    // The blob is built synchronously so clipboard.write stays inside the
    // user gesture — Safari rejects a write that awaits first.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
