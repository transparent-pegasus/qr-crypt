// Profile-to-algorithm and size-constant table.
// Sources: @noble/post-quantum 0.6.1 source and the FIPS 203/204 parameter tables.
// This table is part of the v2 contract; changing it requires a protocol revision.
import type {
  MlDsaAlgorithm,
  MlKemAlgorithm,
  PqProfileId,
  WireSuite,
} from "@/schemas/domain"
import { suiteComponents } from "@/crypto/pq/suites"
import {
  AES_GCM_TAG_BYTES,
  DSA_SEED_BYTES,
  KEM_SEED_BYTES,
  MAX_PLAINTEXT_BYTES,
} from "@/lib/limits"

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
  "ML-DSA-87": {
    algorithm: "ML-DSA-87",
    publicKeyBytes: 2592,
    secretKeyBytes: 4896,
    signatureBytes: 4627,
    seedBytes: DSA_SEED_BYTES,
  },
}

export const PQ_PROFILES: Record<PqProfileId, PqProfileSpec> = {
  maximum: {
    id: "maximum",
    kem: KEM_SIZES["ML-KEM-1024"],
    signature: DSA_SIZES["ML-DSA-87"],
    symmetric: "AES-256-GCM",
    kdf: "HKDF-SHA-256",
  },
}

// One owner for the derived inner-ciphertext ceilings. limits.ts owns raw
// constants; these read the size tables above, so they live beside them
// (limits cannot import this module without a cycle).
// Measured canonical-CBOR envelope overhead allowances; the golden fixtures in
// tests/pq/maximum-artifact-size.golden.test.ts pin the real totals.
const SIGNED_MESSAGE_CBOR_OVERHEAD_BYTES = 1024

export function maxSignedMessageBytes(algorithm: MlDsaAlgorithm): number {
  return (
    MAX_PLAINTEXT_BYTES +
    DSA_SIZES[algorithm].signatureBytes +
    SIGNED_MESSAGE_CBOR_OVERHEAD_BYTES
  )
}

export function maxEnvelopeCiphertextBytes(suite: WireSuite): number {
  const { signature } = suiteComponents(suite)
  return maxSignedMessageBytes(signature) + AES_GCM_TAG_BYTES
}
