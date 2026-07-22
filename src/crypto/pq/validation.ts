// v2 構造の zod strict 検証(WP-13)。canonical-cbor の構造ガード
// (プロトコル定数)の上へ、env 依存の上限(MAX_PLAINTEXT_BYTES 等)と
// 相互制約を重ねる。長さ表は profiles.ts / limits.ts を参照し再定義しない。
import type {
  MlKemMessageEnvelopeV2,
  PublicIdentityBundleV2,
  QrFrameV2,
} from "@/schemas/domain"

export function validateMlKemEnvelopeV2(value: unknown): MlKemMessageEnvelopeV2 {
  void value
  throw new Error("NOT_IMPLEMENTED: WP-13 validateMlKemEnvelopeV2")
}

export function validatePublicIdentityBundleV2(value: unknown): PublicIdentityBundleV2 {
  void value
  throw new Error("NOT_IMPLEMENTED: WP-13 validatePublicIdentityBundleV2")
}

export function validateQrFrameV2(value: unknown): QrFrameV2 {
  void value
  throw new Error("NOT_IMPLEMENTED: WP-13 validateQrFrameV2")
}
