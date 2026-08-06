// Clipboard writes, mapped to the storage failure domain.
import { toAppError } from "@/crypto/errors"

export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
