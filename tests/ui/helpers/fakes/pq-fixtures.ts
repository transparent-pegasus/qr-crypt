import type {
  PostQuantumIdentity,
  PqPublicBundleRecord,
} from "@/schemas/domain"

export const IDENTITY_ID = "I".repeat(22)
export const KEM_KEY_ID = "K".repeat(22)
export const SIGNING_KEY_ID = "S".repeat(22)
export const BUNDLE_RECORD_ID = "R".repeat(22)

export function defaultIdentity(): PostQuantumIdentity {
  return {
    id: IDENTITY_ID,
    name: "自分のPQ ID",
    profile: "maximum",
    kem: {
      algorithm: "ML-KEM-1024",
      keyId: KEM_KEY_ID,
      publicKey: new Uint8Array(1568).fill(1),
      encryptedSeed: { iv: new Uint8Array(12), ciphertext: new Uint8Array(80) },
      fingerprint: "1".repeat(64),
    },
    signing: {
      algorithm: "ML-DSA-87",
      keyId: SIGNING_KEY_ID,
      publicKey: new Uint8Array(2592).fill(2),
      encryptedSeed: { iv: new Uint8Array(12), ciphertext: new Uint8Array(48) },
      fingerprint: "2".repeat(64),
    },
    identityFingerprint: "3".repeat(64),
    status: "active",
    createdAt: 1_723_000_000_000,
  }
}

export function recordFromIdentity(
  identity: PostQuantumIdentity,
): PqPublicBundleRecord {
  return {
    recordId: BUNDLE_RECORD_ID,
    identityId: "P".repeat(22),
    name: "確認済みの相手",
    kem: {
      algorithm: identity.kem.algorithm,
      keyId: "Q".repeat(22),
      publicKey: Uint8Array.from(identity.kem.publicKey),
      fingerprint: "4".repeat(64),
    },
    signing: {
      algorithm: identity.signing.algorithm,
      keyId: "T".repeat(22),
      publicKey: Uint8Array.from(identity.signing.publicKey),
      fingerprint: "5".repeat(64),
    },
    identityFingerprint: "6".repeat(64),
    trust: "fingerprint-confirmed",
    trustConfirmedAt: 1_723_000_000_010,
    bundleCreatedAt: 1_723_000_000_000,
    importedAt: 1_723_000_000_005,
  }
}
