import { assertActiveProfile, assertActiveSuite, resolveSuite } from "@/crypto/pq/suites"
import type { PostQuantumIdentity } from "@/schemas/domain"
import type { PqPublicBundleRecord } from "@/schemas/domain"

export function assertUsableIdentity(identity: PostQuantumIdentity): void {
  assertActiveProfile(identity.profile)
  assertActiveSuite(resolveSuite(identity.kem.algorithm, identity.signing.algorithm))
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
    assertActiveSuite(resolveSuite(record.kem.algorithm, record.signing.algorithm))
    return true
  } catch {
    return false
  }
}
