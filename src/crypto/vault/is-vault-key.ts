// The vault key is the only key this app holds that must never leave the device: it wraps
// every stored secret. A value that reaches here has come back from IndexedDB, so its type
// is a claim rather than a guarantee — this is where the claim is checked.
export function isVaultKey(value: unknown): value is CryptoKey {
  if (typeof value !== "object" || value === null) return false
  const key = value as Partial<CryptoKey>
  const algorithm = key.algorithm as Partial<AesKeyAlgorithm> | undefined
  return (
    key.type === "secret" &&
    key.extractable === false &&
    algorithm?.name === "AES-GCM" &&
    algorithm.length === 256 &&
    Array.isArray(key.usages) &&
    key.usages.includes("encrypt") &&
    key.usages.includes("decrypt")
  )
}
