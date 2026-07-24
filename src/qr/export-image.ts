// QR PNG/SVG/text export and download.
// Filenames must not contain secret information, plaintext, or key material.
import type { QrEcLevel } from "@/schemas/domain"
import * as QRCode from "qrcode"
import { AppError, toAppError } from "@/crypto/errors"
import { shortId } from "@/crypto/random"
import { renderQrSvgString } from "@/qr/encode"

export interface QrExportOptions {
  ecLevel: QrEcLevel
  size: number
}

export async function qrPngBlob(
  payload: string,
  options: QrExportOptions,
): Promise<Blob> {
  try {
    const canvas = document.createElement("canvas")
    await QRCode.toCanvas(canvas, payload, {
      errorCorrectionLevel: options.ecLevel,
      margin: 4,
      width: options.size,
      color: { dark: "#000000", light: "#FFFFFFFF" },
    })
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error("canvas export failed"))
        else resolve(blob)
      }, "image/png")
    })
  } catch (error) {
    throw toAppError(error, "QR_TOO_LARGE")
  }
}

export async function qrSvgBlob(
  payload: string,
  options: Pick<QrExportOptions, "ecLevel">,
): Promise<Blob> {
  try {
    const svg = await renderQrSvgString(payload, options)
    return new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  } catch (error) {
    throw toAppError(error, "QR_TOO_LARGE")
  }
}

// Remove control characters and / \ : * ? " < > |, trim, use "qr" if empty,
// and truncate to 80 characters.
export function sanitizeQrFileName(name: string): string {
  let result = ""
  const forbidden = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|"])
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0
    if (code < 32 || (code >= 127 && code <= 159) || forbidden.has(character)) {
      continue
    }
    result += character
  }
  result = result.trim()
  if (result.length === 0) result = "qr"
  return Array.from(result).slice(0, 80).join("")
}

// `<sanitized-name>-<shortId>.<ext>`
export function buildExportFileName(
  name: string,
  id: string,
  ext: "png" | "svg" | "txt",
): string {
  return `${sanitizeQrFileName(name)}-${shortId(id)}.${ext}`
}

export function triggerDownload(blob: Blob, fileName: string): void {
  try {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.rel = "noopener"
    anchor.style.display = "none"
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch {
    throw new AppError("STORAGE_FAILED")
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
