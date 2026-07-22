// プロファイル→アルゴリズム・サイズ定数表(spec2 §2、plan2.1 §H WP-A2 recon 値)。
// 出典: @noble/post-quantum 0.6.1 実ソース + FIPS 203/204 のパラメーター表。
// この表は v2 契約の一部であり、変更はプロトコル改版を意味する。
import type { MlDsaAlgorithm, MlKemAlgorithm, PqProfileId } from "@/schemas/domain"
import { DSA_SEED_BYTES, KEM_SEED_BYTES } from "@/lib/limits"

export interface KemSizeSpec {
  algorithm: MlKemAlgorithm
  publicKeyBytes: number
  secretKeyBytes: number
  ciphertextBytes: number
  sharedSecretBytes: 32
  seedBytes: typeof KEM_SEED_BYTES
}

export interface DsaSizeSpec {
  algorithm: MlDsaAlgorithm
  publicKeyBytes: number
  secretKeyBytes: number
  signatureBytes: number
  seedBytes: typeof DSA_SEED_BYTES
}

export interface PqProfileSpec {
  id: PqProfileId
  kem: KemSizeSpec
  signature: DsaSizeSpec
  symmetric: "AES-256-GCM"
  kdf: "HKDF-SHA-256"
}

export const KEM_SIZES: Record<MlKemAlgorithm, KemSizeSpec> = {
  "ML-KEM-768": {
    algorithm: "ML-KEM-768",
    publicKeyBytes: 1184,
    secretKeyBytes: 2400,
    ciphertextBytes: 1088,
    sharedSecretBytes: 32,
    seedBytes: KEM_SEED_BYTES,
  },
  "ML-KEM-1024": {
    algorithm: "ML-KEM-1024",
    publicKeyBytes: 1568,
    secretKeyBytes: 3168,
    ciphertextBytes: 1568,
    sharedSecretBytes: 32,
    seedBytes: KEM_SEED_BYTES,
  },
}

export const DSA_SIZES: Record<MlDsaAlgorithm, DsaSizeSpec> = {
  "ML-DSA-65": {
    algorithm: "ML-DSA-65",
    publicKeyBytes: 1952,
    secretKeyBytes: 4032,
    signatureBytes: 3309,
    seedBytes: DSA_SEED_BYTES,
  },
  "ML-DSA-87": {
    algorithm: "ML-DSA-87",
    publicKeyBytes: 2592,
    secretKeyBytes: 4896,
    signatureBytes: 4627,
    seedBytes: DSA_SEED_BYTES,
  },
}

export const PQ_PROFILES: Record<PqProfileId, PqProfileSpec> = {
  balanced: {
    id: "balanced",
    kem: KEM_SIZES["ML-KEM-768"],
    signature: DSA_SIZES["ML-DSA-65"],
    symmetric: "AES-256-GCM",
    kdf: "HKDF-SHA-256",
  },
  // maximum は型・定数のみ予約(plan2.1 §A: 初期リリースでは UI・ID 作成に露出しない)
  maximum: {
    id: "maximum",
    kem: KEM_SIZES["ML-KEM-1024"],
    signature: DSA_SIZES["ML-DSA-87"],
    symmetric: "AES-256-GCM",
    kdf: "HKDF-SHA-256",
  },
}

export function profileForKemAlgorithm(algorithm: MlKemAlgorithm): PqProfileSpec {
  return algorithm === "ML-KEM-768" ? PQ_PROFILES.balanced : PQ_PROFILES.maximum
}

export function profileForDsaAlgorithm(algorithm: MlDsaAlgorithm): PqProfileSpec {
  return algorithm === "ML-DSA-65" ? PQ_PROFILES.balanced : PQ_PROFILES.maximum
}
