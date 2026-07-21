// QR 生成(spec §13)。ペイロード文字列(ASCII)のみを受け取る —
// 平文をこのモジュールへ渡してはならない(spec §13/plan C11)。
import type { Preferences, QrArtifactKind, QrEcLevel } from "@/schemas/domain"
import * as QRCode from "qrcode"
import { buildAad } from "@/crypto/envelope"
import { AppError, toAppError } from "@/crypto/errors"
import { MAX_PLAINTEXT_BYTES, WRAPPED_KEY_BYTES } from "@/lib/limits"
import { encodeEnvelopeToPayload } from "@/qr/payload"

export type { QrEcLevel } from "@/schemas/domain"

// QR version 40・バイトモードの容量(docs/qr-protocol.md §7)
const QR_BYTE_CAPACITY: Record<QrEcLevel, number> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
}

export function qrByteCapacity(ecLevel: QrEcLevel): number {
  return QR_BYTE_CAPACITY[ecLevel]
}

// ペイロードは ASCII のみのため文字数 = バイト数
export function payloadFits(payload: string, ecLevel: QrEcLevel): boolean {
  return payload.length <= QR_BYTE_CAPACITY[ecLevel]
}

// EC レベル政策(plan §12-3): 暗号文のみ設定に従い、鍵系 QR は常に H
export function ecLevelFor(
  kind: QrArtifactKind,
  prefs: Pick<Preferences, "qrErrorCorrection">,
): QrEcLevel {
  return kind === "ciphertext" ? prefs.qrErrorCorrection : "H"
}

export interface QrRenderOptions {
  ecLevel: QrEcLevel
  size: number
}

// 白背景・黒セル固定、quiet zone(margin)= 4(ダークモードでも不変)
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
      margin: 4,
      width: options.size,
      color: { dark: "#000000", light: "#FFFFFFFF" },
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
      margin: 4,
      color: { dark: "#000000", light: "#FFFFFFFF" },
    })
  } catch (error) {
    throw toAppError(error, "QR_TOO_LARGE")
  }
}

// 同寸ダミーエンベロープを実際に CBOR+base64url 化して長さを返す(plan §12-9)
export function estimatePayloadChars(
  plaintextBytes: number,
  algorithm: "A256GCM" | "RSA-HYBRID",
): number {
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
  if (algorithm === "A256GCM") {
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
  const aad = buildAad({
    v: 1,
    type: "message",
    algorithm: "RSA-OAEP-3072+A256GCM",
    keyId,
    createdAt,
  })
  return encodeEnvelopeToPayload({
    v: 1,
    type: "message",
    algorithm: "RSA-OAEP-3072+A256GCM",
    recipientKeyId: keyId,
    createdAt,
    wrappedKey: new Uint8Array(WRAPPED_KEY_BYTES),
    iv: new Uint8Array(12),
    ciphertext,
    aad,
  }).length
}
