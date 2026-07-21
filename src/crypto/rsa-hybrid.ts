// RSA-OAEP-3072 + AES-256-GCM ハイブリッド(spec §9 / docs/qr-protocol.md §5)。
// RSA で本文を直接暗号化しない。秘密鍵は non-extractable。
import type { RsaHybridEnvelopeV1 } from "@/crypto/envelope"

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// modulusLength 3072 / publicExponent 65537 / hash SHA-256
// publicKey: ["encrypt", "wrapKey"](extractable)
// privateKey: ["decrypt", "unwrapKey"](extractable: false)
export function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return notImplemented()
}

export function encryptRsaHybrid(args: {
  publicKey: CryptoKey
  recipientKeyId: string
  plaintext: Uint8Array
  now: number
}): Promise<RsaHybridEnvelopeV1> {
  return notImplemented(args)
}

export function decryptRsaHybrid(args: {
  privateKey: CryptoKey
  envelope: RsaHybridEnvelopeV1
}): Promise<Uint8Array> {
  return notImplemented(args)
}
