// エンベロープの Zod strict 検証(docs/qr-protocol.md §3/§6)。
// 未知キー拒否・バイト長固定・prefix と type の整合まで担う。
// 実装は WP-2(qr/payload.ts の decodePayload から使用される)。
import type { AnyEnvelopeV1 } from "@/crypto/envelope"

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// CBOR デコード済みの unknown 値を検証し、型付きエンベロープを返す。
// 検証順序: v → type(プレフィックス整合)→ algorithm → strict 形状/長さ。
// 失敗は AppError(UNSUPPORTED_PROTOCOL_VERSION / UNSUPPORTED_ALGORITHM /
// INVALID_QR_PAYLOAD)へ変換して throw。
export function validateDecodedEnvelope(
  value: unknown,
  expectedPrefixKind: string,
): AnyEnvelopeV1 {
  return notImplemented(value, expectedPrefixKind)
}
