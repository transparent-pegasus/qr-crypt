import { buildPublicBundle } from "@/crypto/pq/identity"
import { generateKeyId } from "@/crypto/random"
import type { PostQuantumIdentity, PqPublicBundleRecord } from "@/schemas/domain"

export function publicRecord(
  identity: PostQuantumIdentity,
  importedAt: number,
): PqPublicBundleRecord {
  const bundle = buildPublicBundle(identity)
  return {
    recordId: generateKeyId(),
    identityId: bundle.identityId,
    name: identity.name,
    kem: {
      ...bundle.kem,
      fingerprint: identity.kem.fingerprint,
    },
    signing: {
      ...bundle.signing,
      fingerprint: identity.signing.fingerprint,
    },
    identityFingerprint: identity.identityFingerprint,
    trust: "unverified",
    bundleCreatedAt: bundle.createdAt,
    importedAt,
  }
}
