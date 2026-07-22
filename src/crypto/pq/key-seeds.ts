// 鍵生成シード(spec2 §8)。KEM 64B / DSA 32B。
// KEM と DSA で同じシード・同じ CSPRNG 呼出結果を共用してはならない(spec2 §20 —
// 生成経路が別 randomBytes 呼出であることをテストで固定する)。
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
