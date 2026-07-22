// QR 生成(spec §13)。ペイロード文字列(ASCII)のみを受け取る —
// 平文をこのモジュールへ渡してはならない(spec §13/plan C11)。
import type { Preferences, QrEcLevel, UiAlgorithm } from "@/schemas/domain"
import * as QRCode from "qrcode"
import { buildAad } from "@/crypto/envelope"
import { AppError, toAppError } from "@/crypto/errors"
import { MAX_PLAINTEXT_BYTES } from "@/lib/limits"
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

// EC レベル政策(plan2.2.1 §E-10): v1 単枚メッセージだけ設定に従い、
// 永続化する鍵 QR は H、OCF2 フレームは Q に固定する。
export type QrPayloadEcKind = "message" | "stored-key" | "multipart-frame"

export function ecLevelFor(
  kind: QrPayloadEcKind,
  prefs: Pick<Preferences, "qrErrorCorrection">,
): QrEcLevel {
  if (kind === "message") return prefs.qrErrorCorrection
  return kind === "multipart-frame" ? "Q" : "H"
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

// 同寸ダミーエンベロープを実際に CBOR+base64url 化して長さを返す(plan §12-9)。
// v1 経路専用 — PQ 方式のサイズ内訳は WP-14 の framed 見積り(plan2.1 §D/U24:
// 実エンベロープ → OCF2 分割 → frameCount)で置き換える。
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
