// 鍵の import/export。import は必ず厳密検証を伴う。

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function exportAesKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  return notImplemented(key)
}

// 32 バイト以外は AppError(INVALID_QR_PAYLOAD)。extractable: true で復元
export function importAesKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return notImplemented(raw)
}

export function exportPublicKeySpki(key: CryptoKey): Promise<Uint8Array> {
  return notImplemented(key)
}

// importKey 成功後に type/algorithm.name/modulusLength===3072/
// publicExponent=[1,0,1]/hash===SHA-256 を検証(plan §13 C1)。
// パラメーター相違 → UNSUPPORTED_ALGORITHM / 破損 SPKI → INVALID_QR_PAYLOAD
export function importPublicKeySpki(spki: Uint8Array): Promise<CryptoKey> {
  return notImplemented(spki)
}
