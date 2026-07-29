// QR generation. Accept only ASCII payload strings; plaintext must never be passed
// into this module.
import type { Preferences, QrEcLevel, UiAlgorithm } from "@/schemas/domain"
import * as QRCode from "qrcode"
import { buildAad } from "@/crypto/envelope"
import { AppError, toAppError } from "@/crypto/errors"
import { MAX_PLAINTEXT_BYTES } from "@/lib/limits"
import { encodeEnvelopeToPayload } from "@/qr/payload"

export type { QrEcLevel } from "@/schemas/domain"

// QR version 40 byte-mode capacities (docs/spec/qr-protocol.md §7).
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

// EC-level policy: only single-image v1 messages follow preferences.
// The v1 OCK1 symmetric-key QR is fixed at H; PQ key artifacts are never
// single images and always display as OCF2 frames at Q.
export type QrPayloadEcKind = "message" | "stored-key" | "multipart-frame"

export function ecLevelFor(
  kind: QrPayloadEcKind,
  prefs: Pick<Preferences, "qrErrorCorrection">,
): QrEcLevel {
  if (kind === "message") return prefs.qrErrorCorrection
  return kind === "multipart-frame" ? "Q" : "H"
}

// The relay cannot know which EC level the sender chose: an OCM1 payload carries
// no EC field. Start at the app's own default (Q, which OCF2 frames also fix) so
// nothing under the Q capacity pins to a v40 symbol and loses module size on the
// screen-to-camera hop, and degrade only when the payload does not fit. H is
// never selected — it would raise the QR version for no benefit on a clean screen.
export function relayMessageEcLevel(payload: string): QrEcLevel {
  if (payloadFits(payload, "Q")) return "Q"
  return payloadFits(payload, "M") ? "M" : "L"
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

// Return the length after actually encoding an equal-size dummy envelope as CBOR+base64url.
// This is only for the v1 path.
export function estimatePayloadChars(
  plaintextBytes: number,
  algorithm: UiAlgorithm,
): number {
  if (algorithm !== "A256GCM") {
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  if (
    !Number.isSafeInteger(plaintextBytes) ||
    plaintextBytes < 0 ||
    plaintextBytes > MAX_PLAINTEXT_BYTES
  ) {
    throw new AppError("QR_TOO_LARGE")
  }
  const keyId = "A".repeat(22)
  const createdAt = 1_700_000_000_000
  const ciphertext = new Uint8Array(plaintextBytes + 16)
  const aad = buildAad({
    v: 1,
    type: "message",
    algorithm: "A256GCM",
    keyId,
    createdAt,
  })
  return encodeEnvelopeToPayload({
    v: 1,
    type: "message",
    algorithm: "A256GCM",
    keyId,
    createdAt,
    iv: new Uint8Array(12),
    ciphertext,
    aad,
  }).length
}
