import type { StoredKeyRecord } from "@/schemas/domain"

export function cryptoKey(): CryptoKey {
  return {
    type: "secret",
    extractable: true,
    algorithm: { name: "AES-GCM", length: 256 },
    usages: ["encrypt", "decrypt"],
  } as CryptoKey
}

export function defaultKeys(): StoredKeyRecord[] {
  return [
    {
      id: "sym-key-00000001",
      name: "共通鍵A",
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint:
        "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      createdAt: 1_720_000_000_000,
      useCount: 2,
      status: "active",
      symmetricKey: cryptoKey(),
    },
  ]
}

export function generatedFingerprint(counter: number): string {
  return counter.toString(16).padStart(64, "0")
}
