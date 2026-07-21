// AES-256-GCM(spec §8 / docs/qr-protocol.md §5)。
// IV は暗号化ごとに randomBytes(12)。tagLength は 128 を明示。
import type { AesMessageEnvelopeV1 } from "@/crypto/envelope"

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// extractable: true(共通鍵 QR 生成のため)、usages: encrypt/decrypt
export function generateAesKey(): Promise<CryptoKey> {
  return notImplemented()
}

export function encryptWithAesKey(args: {
  key: CryptoKey
  keyId: string
  plaintext: Uint8Array
  now: number
}): Promise<AesMessageEnvelopeV1> {
  return notImplemented(args)
}

// AAD はエンベロープから再計算し envelope.aad と一致検証してから復号。
// 復号結果が MAX_PLAINTEXT_BYTES 超なら DECRYPTION_FAILED(plan §13 C12)。
export function decryptWithAesKey(args: {
  key: CryptoKey
  envelope: AesMessageEnvelopeV1
}): Promise<Uint8Array> {
  return notImplemented(args)
}
