// Key-generation seeds: KEM 64B / DSA 32B, following FIPS 203/204 KeyGen.
// KEM and DSA must not share either a seed or the result of one CSPRNG call
// (tests pin that the generation paths make separate randomBytes calls).
import { randomBytes } from "@/crypto/random"
import { AppError } from "@/crypto/errors"
import { DSA_SEED_BYTES, KEM_SEED_BYTES } from "@/lib/limits"

export function generateKemSeed(): Uint8Array {
  return randomBytes(KEM_SEED_BYTES)
}

export function generateDsaSeed(): Uint8Array {
  return randomBytes(DSA_SEED_BYTES)
}

export function assertKemSeedLength(seed: Uint8Array): void {
  if (seed.byteLength !== KEM_SEED_BYTES) throw new AppError("ENCRYPTION_FAILED")
}

export function assertDsaSeedLength(seed: Uint8Array): void {
  if (seed.byteLength !== DSA_SEED_BYTES) throw new AppError("ENCRYPTION_FAILED")
}
