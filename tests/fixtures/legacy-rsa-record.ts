export const LEGACY_RSA_ID = "R".repeat(22)

export async function legacyRsaRecord() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 3_072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  )) as CryptoKeyPair

  return {
    id: LEGACY_RSA_ID,
    name: "retired RSA row",
    kind: "rsa-key-pair",
    algorithm: "RSA-OAEP-3072",
    fingerprint: "a".repeat(64),
    createdAt: 1_700_000_000_000,
    useCount: 0,
    status: "active",
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
  } as const
}
