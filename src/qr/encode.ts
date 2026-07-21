// QR 生成(spec §13)。ペイロード文字列(ASCII)のみを受け取る —
// 平文をこのモジュールへ渡してはならない(spec §13/plan C11)。
import type { Preferences, QrArtifactKind, QrEcLevel } from "@/schemas/domain"

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

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// 白背景・黒セル固定、quiet zone(margin)= 4(ダークモードでも不変)
export function renderQrDataUrl(
  payload: string,
  options: QrRenderOptions,
): Promise<string> {
  return notImplemented(payload, options)
}

export function renderQrSvgString(
  payload: string,
  options: Pick<QrRenderOptions, "ecLevel">,
): Promise<string> {
  return notImplemented(payload, options)
}

// 同寸ダミーエンベロープを実際に CBOR+base64url 化して長さを返す(plan §12-9)
export function estimatePayloadChars(
  plaintextBytes: number,
  algorithm: "A256GCM" | "RSA-HYBRID",
): number {
  return notImplemented(plaintextBytes, algorithm)
}
