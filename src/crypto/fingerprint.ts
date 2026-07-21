// 鍵指紋(spec §11 / docs/qr-protocol.md §8)。
// 内部識別は sha256Hex 全体。display は簡易照合用の短縮表示。

export interface KeyFingerprint {
  sha256Hex: string
  display: string
}

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// 先頭 8 バイトを 2 バイトずつ big-endian uint16 % 10000 → 4 桁ゼロ埋め × 4 グループ
export function formatFingerprintDisplay(hash: Uint8Array): string {
  return notImplemented(hash)
}

// AES: raw 32B を SHA-256
export function fingerprintAesKey(key: CryptoKey): Promise<KeyFingerprint> {
  return notImplemented(key)
}

// 公開鍵: SPKI DER を SHA-256
export function fingerprintPublicKey(key: CryptoKey): Promise<KeyFingerprint> {
  return notImplemented(key)
}
