// QR ペイロード文字列の符号化・復号(docs/qr-protocol.md §1/§2/§6)。
// 検証順序とエラー対応は qr-protocol.md §6 の表が正。
import type {
  AnyEnvelopeV1,
  MessageEnvelope,
  PublicKeyEnvelopeV1,
  SymmetricKeyEnvelopeV1,
} from "@/crypto/envelope"

export const QR_PREFIX = {
  message: "OCM1:",
  "symmetric-key": "OCK1:",
  "public-key": "OCP1:",
  // v1 では予約のみ(生成・受理とも行わない)
  "encrypted-private-key": "OCB1:",
} as const

export type PayloadKind = "message" | "symmetric-key" | "public-key"

export type DecodedPayload =
  | { kind: "message"; envelope: MessageEnvelope }
  | { kind: "symmetric-key"; envelope: SymmetricKeyEnvelopeV1 }
  | { kind: "public-key"; envelope: PublicKeyEnvelopeV1 }

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// CBOR は共有 Encoder({ useRecords: false, tagUint8Array: false })・
// 型別の固定キー順ビルダー経由でのみ符号化する(plan §12-2)
export function encodeEnvelopeToPayload(envelope: AnyEnvelopeV1): string {
  return notImplemented(envelope)
}

export function decodePayload(text: string): DecodedPayload {
  return notImplemented(text)
}

export function payloadSha256Hex(payload: string): Promise<string> {
  return notImplemented(payload)
}
