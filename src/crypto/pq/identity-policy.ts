import { assertActiveProfile, resolveSuite } from "@/crypto/pq/suites"
import type { PostQuantumIdentity, PqPublicBundleRecord } from "@/schemas/domain"

export function assertUsableIdentity(identity: PostQuantumIdentity): void {
  assertActiveProfile(identity.profile)
  resolveSuite(identity.kem.algorithm, identity.signing.algorithm)
}

export function isUsableIdentity(identity: PostQuantumIdentity): boolean {
  try {
    assertUsableIdentity(identity)
    return true
  } catch {
    return false
  }
}

export function isUsableBundle(record: PqPublicBundleRecord): boolean {
  try {
    resolveSuite(record.kem.algorithm, record.signing.algorithm)
    return true
  } catch {
    return false
  }
}
