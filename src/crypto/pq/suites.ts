// v2 suite derivation; the mappings are a wire-compatibility contract.
// Derive the suite uniquely from the selected keys' actual algorithm combination,
// not from a preference. The UI profile is used only to filter/default candidates.
import type {
  MlDsaAlgorithm,
  MlKemAlgorithm,
  PqProfileId,
  WireSuite,
} from "@/schemas/domain"
import { AppError } from "@/crypto/errors"

export const ACTIVE_PROFILE: PqProfileId = "maximum"

export function assertActiveProfile(profile: PqProfileId): void {
  if (profile !== ACTIVE_PROFILE) throw new AppError("UNSUPPORTED_ALGORITHM")
}

export function assertActiveSuite(suite: WireSuite): void {
  if (suite !== "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM") {
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
}

export function resolveSuite(
  kem: MlKemAlgorithm,
  signature: MlDsaAlgorithm,
): WireSuite {
  if (kem !== "ML-KEM-1024" || signature !== "ML-DSA-87") {
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  return "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM"
}

export interface SuiteComponents {
  kem: MlKemAlgorithm
  signature: MlDsaAlgorithm
}

// Reverse lookup for decryption-side cross-binding.
// It must round-trip with resolveSuite.
export function suiteComponents(suite: WireSuite): SuiteComponents {
  assertActiveSuite(suite)
  return { kem: "ML-KEM-1024", signature: "ML-DSA-87" }
}
