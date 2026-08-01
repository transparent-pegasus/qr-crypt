// QR generation. Accept only ASCII payload strings; plaintext must never be passed
// into this module.
import type { QrEcLevel } from "@/schemas/domain"
import * as QRCode from "qrcode"
import { AppError, toAppError } from "@/crypto/errors"

// QR version 40 byte-mode capacities (docs/spec/qr-protocol-v2.md §3.3).
const QR_BYTE_CAPACITY: Record<QrEcLevel, number> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
}

export function qrByteCapacity(ecLevel: QrEcLevel): number {
  return QR_BYTE_CAPACITY[ecLevel]
}

// Payloads are ASCII-only, so character count equals byte count.
export function payloadFits(payload: string, ecLevel: QrEcLevel): boolean {
  return payload.length <= QR_BYTE_CAPACITY[ecLevel]
}

export interface QrRenderOptions {
  ecLevel: QrEcLevel
  size: number
}

export const QR_RENDER_STYLE = {
  margin: 4,
  color: { dark: "#000000", light: "#FFFFFFFF" },
} as const

// Fix the background to white, modules to black, and quiet zone (margin) to 4,
// unchanged in dark mode.
export async function renderQrDataUrl(
  payload: string,
  options: QrRenderOptions,
): Promise<string> {
  if (!payloadFits(payload, options.ecLevel)) {
    throw new AppError("QR_TOO_LARGE")
  }
  try {
    return await QRCode.toDataURL(payload, {
      errorCorrectionLevel: options.ecLevel,
      width: options.size,
      ...QR_RENDER_STYLE,
    })
  } catch (error) {
    throw toAppError(error, "QR_TOO_LARGE")
  }
}

export async function renderQrSvgString(
  payload: string,
  options: Pick<QrRenderOptions, "ecLevel">,
): Promise<string> {
  if (!payloadFits(payload, options.ecLevel)) {
    throw new AppError("QR_TOO_LARGE")
  }
  try {
    return await QRCode.toString(payload, {
      type: "svg",
      errorCorrectionLevel: options.ecLevel,
      ...QR_RENDER_STYLE,
    })
  } catch (error) {
    throw toAppError(error, "QR_TOO_LARGE")
  }
}
