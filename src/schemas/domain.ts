// Sole owner of shared domain types.
// This module is dependency-free; adding imports is prohibited because UI-test module
// mocks would become cyclic. UI-layer algorithm IDs and wire (envelope) algorithm IDs
// are distinct. Always convert between them through this module's mappers; direct string
// comparison is prohibited. v2 suite derivation (resolveSuite/suiteComponents) lives in
// crypto/pq/suites.ts.

// ---------------------------------------------------------------------------
// Algorithm IDs and suites (v1 A256GCM + v2 symmetric/PQ).
// ---------------------------------------------------------------------------

export type UiAlgorithm = "A256GCM" | "MLKEM1024_A256GCM" | "MLKEM1024_MLDSA87_A256GCM"

export type WireAlgorithm = "A256GCM"

export const SYM_SUITE = "HKDF-SHA256+A256GCM" as const
export type SymSuite = typeof SYM_SUITE

export type QrEcLevel = "L" | "M" | "Q" | "H"

export type KeyKind = "symmetric" | "rsa-key-pair" | "public-key"
export type SymmetricKeyStatus = "active" | "rotated"

export interface StoredKeyRecord {
  id: string
  name: string
  kind: KeyKind
  algorithm: string
  fingerprint: string
  createdAt: number
  lastUsedAt?: number
  useCount: number
  status: SymmetricKeyStatus
  rotatedFromId?: string | undefined
  rotatedAt?: number | undefined
  publicKey?: CryptoKey
  privateKey?: CryptoKey
  symmetricKey?: CryptoKey
}

// Mapper exclusively for the v1 A256GCM wire format. Resolve PQ wire algorithms with
// resolveSuite in crypto/pq/suites.ts. This dependency-free module cannot throw AppError.
export function toWireAlgorithm(algorithm: UiAlgorithm): WireAlgorithm {
  if (algorithm === "A256GCM") return "A256GCM"
  throw new TypeError("v2 algorithm requires resolveSuite (crypto/pq/suites)")
}

export function toUiAlgorithm(algorithm: WireAlgorithm): UiAlgorithm {
  return algorithm
}

// ---------------------------------------------------------------------------
// v2 post-quantum algorithms and suites; see docs/spec/qr-protocol-v2.md §4.
// ---------------------------------------------------------------------------

export const ML_KEM_ALGORITHMS = ["ML-KEM-768", "ML-KEM-1024"] as const
export type MlKemAlgorithm = (typeof ML_KEM_ALGORITHMS)[number]

export const ML_DSA_ALGORITHMS = ["ML-DSA-65", "ML-DSA-87"] as const
export type MlDsaAlgorithm = (typeof ML_DSA_ALGORITHMS)[number]

export const PQ_PROFILE_IDS = ["balanced", "maximum"] as const
export type PqProfileId = (typeof PQ_PROFILE_IDS)[number]

export const WIRE_SUITES = [
  "ML-KEM-768+HKDF-SHA256+A256GCM",
  "ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM",
  "ML-KEM-1024+HKDF-SHA256+A256GCM",
  "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
] as const
export type WireSuite = (typeof WIRE_SUITES)[number]

// ---------------------------------------------------------------------------
// v2 Vault; see docs/spec/qr-protocol-v2.md §7.
// ---------------------------------------------------------------------------

export interface EncryptedSecret {
  iv: Uint8Array
  ciphertext: Uint8Array
}

export type VaultSecretRole = "ml-kem-seed" | "ml-dsa-seed"

// ---------------------------------------------------------------------------
// v2 post-quantum identities; see docs/spec/qr-protocol-v2.md §7.1.
// ---------------------------------------------------------------------------

// active: may encrypt and sign / rotated: decryption and verification only (old generation) /
// revoked: disabled on this device (decryption only; revocation is not propagated externally)
export type PqKeyStatus = "active" | "rotated" | "revoked"

export interface PqKemKeyMaterial {
  algorithm: MlKemAlgorithm
  keyId: string // 22-character base64url encoding of 16 random bytes (KEY_ID_PATTERN).
  publicKey: Uint8Array
  encryptedSeed: EncryptedSecret // Vault encryption of a 64B seed (AAD = buildVaultAadV2).
  fingerprint: string // sha256 hex from pqKeyFingerprint("kem", ...).
}

export interface PqSigningKeyMaterial {
  algorithm: MlDsaAlgorithm
  keyId: string
  publicKey: Uint8Array
  encryptedSeed: EncryptedSecret // 32B seed from a CSPRNG call independent of the KEM seed.
  fingerprint: string
}

// Record in the pqIdentities store (keyPath: id).
// Rotation occurs per identity: create the new generation with a new id and new keyId,
// and retain the previous-generation row with status="rotated" for decryption/verification only.
export interface PostQuantumIdentity {
  id: string
  name: string
  profile: PqProfileId
  kem: PqKemKeyMaterial
  signing: PqSigningKeyMaterial
  identityFingerprint: string // Fingerprint of the public tuple excluding name.
  status: PqKeyStatus
  rotatedFromId?: string // ID of the previous-generation identity (lineage).
  rotatedAt?: number
  revokedAt?: number
  createdAt: number
  lastUsedAt?: number
}

// ---------------------------------------------------------------------------
// v2 public-key bundles and imported records; see docs/spec/qr-protocol-v2.md §7.1.
// ---------------------------------------------------------------------------

export interface PublicIdentityBundleV2 {
  version: 2
  type: "pq-public-identity"
  identityId: string
  name?: string
  kem: {
    algorithm: MlKemAlgorithm
    keyId: string
    publicKey: Uint8Array
  }
  signing: {
    algorithm: MlDsaAlgorithm
    keyId: string
    publicKey: Uint8Array
  }
  createdAt: number
}

export type PqTrustLevel = "unverified" | "fingerprint-confirmed"

// Record in the pqPublicBundles store (keyPath: recordId).
// identityId is sender-asserted, so it is not unique; by-identityId is non-unique.
export interface PqPublicBundleRecord {
  recordId: string
  identityId: string
  name?: string // Unauthenticated display name from the bundle; never use alone as trusted UI.
  kem: {
    algorithm: MlKemAlgorithm
    keyId: string
    publicKey: Uint8Array
    fingerprint: string
  }
  signing: {
    algorithm: MlDsaAlgorithm
    keyId: string
    publicKey: Uint8Array
    fingerprint: string
  }
  identityFingerprint: string
  trust: PqTrustLevel
  trustConfirmedAt?: number
  revokedAt?: number // Local disablement; not propagated externally.
  bundleCreatedAt: number // Wire createdAt: device-asserted time, not trusted time.
  importedAt: number
  lastUsedAt?: number
}

// ---------------------------------------------------------------------------
// v2 inner messages as a strict discriminated union; see docs/spec/qr-protocol-v2.md §5.
// ---------------------------------------------------------------------------

export interface MessageBodyCommonV2 {
  version: 2
  messageId: Uint8Array // Fixed 16B from the CSPRNG; not replay prevention (§G).
  createdAt: number // Device-asserted time, not trusted time.
  recipientKemKeyId: string
  plaintext: Uint8Array
}

// For unsigned messages, omit the senderSigningKeyId key entirely rather than using
// an empty string (U29).
export type UnsignedMessageBodyV2 = MessageBodyCommonV2

export interface SignedMessageBodyV2 extends MessageBodyCommonV2 {
  senderSigningKeyId: string
}

// kind is an in-memory discriminator and is not included in wire CBOR; the outer suite
// is authoritative. Wire shape: unsigned suite → a standalone UnsignedMessageBodyV2 map /
// signed suite → a { body, signature } map (docs/spec/qr-protocol-v2.md §5).
export interface UnsignedMessageV2 {
  kind: "unsigned"
  body: UnsignedMessageBodyV2
}

export interface SignedMessageV2 {
  kind: "signed"
  body: SignedMessageBodyV2
  signature: {
    algorithm: MlDsaAlgorithm
    value: Uint8Array
  }
}

export type InnerMessageV2 = UnsignedMessageV2 | SignedMessageV2

// ---------------------------------------------------------------------------
// v2 outer envelopes and AAD; see docs/spec/qr-protocol-v2.md §3.
// ---------------------------------------------------------------------------

export interface MlKemMessageEnvelopeV2 {
  version: 2
  type: "pq-message"
  suite: WireSuite
  recipientKemKeyId: string
  kemCiphertext: Uint8Array
  hkdfSalt: Uint8Array // 32B CSPRNG
  iv: Uint8Array // 12B CSPRNG
  ciphertext: Uint8Array
}

export interface MlKemAadV2 {
  version: 2
  type: "pq-message"
  suite: WireSuite
  recipientKemKeyId: string
  kemCiphertextSha256: Uint8Array // Receiver recomputes it from kemCiphertext and compares.
}

export interface SymMessageEnvelopeV2 {
  version: 2
  type: "sym-message"
  suite: SymSuite
  keyId: string
  createdAt: number
  hkdfSalt: Uint8Array
  iv: Uint8Array
  ciphertext: Uint8Array
}

export interface SymAadV2 {
  version: 2
  type: "sym-message"
  suite: SymSuite
  keyId: string
  createdAt: number
}

export interface SymmetricKeyEnvelopeV2 {
  version: 2
  type: "symmetric-key"
  algorithm: "A256GCM"
  keyId: string
  createdAt: number
  key: Uint8Array
}

// ---------------------------------------------------------------------------
// v2 decryption result. signed-key-unknown has no plaintext property;
// the type prevents constructing one. senderSigningKeyId supports the signing-key import path.
// Both receipt values are authenticated as part of the inner message body. createdAt is
// device-asserted metadata, not trusted time.
// ---------------------------------------------------------------------------

export type PqDecryptResult =
  | {
      kind: "unsigned"
      plaintext: Uint8Array
      messageId: Uint8Array
      createdAt: number
    }
  | {
      kind: "signed-valid"
      plaintext: Uint8Array
      messageId: Uint8Array
      createdAt: number
      senderSigningKeyId: string
    }
  | { kind: "signed-key-unknown"; senderSigningKeyId: string }

// ---------------------------------------------------------------------------
// v2 multipart QR frames; see docs/spec/qr-protocol-v2.md §6.
// ---------------------------------------------------------------------------

// Every v2 envelope type can be transported in frames; message types are not storable.
export const V2_ARTIFACT_TYPES = [
  "pq-message",
  "sym-message",
  "symmetric-key",
  "pq-public-identity",
  "pq-kem-public-key",
  "pq-dsa-public-key",
  "encrypted-seed-backup",
] as const
export type V2ArtifactType = (typeof V2_ARTIFACT_TYPES)[number]
export type StorableArtifactKind = Exclude<
  V2ArtifactType,
  "pq-message" | "sym-message" | "encrypted-seed-backup"
>

export interface QrFrameV2 {
  version: 2
  type: "qr-frame"
  transferId: Uint8Array // 16 random bytes.
  artifactType: V2ArtifactType
  frameIndex: number // Zero-based (0..frameCount-1).
  frameCount: number // 1..PROTOCOL_MAX_FRAMES(128)
  totalByteLength: number // Total raw artifact-CBOR byte length.
  chunk: Uint8Array // Slice of raw artifact-CBOR bytes; double base64url is prohibited (§D1).
}

// ---------------------------------------------------------------------------
// v2 single public-key envelopes (OCP2/OCS2); see docs/spec/qr-protocol-v2.md §1 and §7.1.
// ---------------------------------------------------------------------------

export interface KemPublicKeyEnvelopeV2 {
  version: 2
  type: "pq-kem-public-key"
  identityId: string
  name?: string
  algorithm: MlKemAlgorithm
  keyId: string
  publicKey: Uint8Array
  createdAt: number
}

export interface DsaPublicKeyEnvelopeV2 {
  version: 2
  type: "pq-dsa-public-key"
  identityId: string
  name?: string
  algorithm: MlDsaAlgorithm
  keyId: string
  publicKey: Uint8Array
  createdAt: number
}

// ---------------------------------------------------------------------------
// Preferences. As in v1, theme is owned by localStorage "oc-theme",
// outside the database.
// ---------------------------------------------------------------------------

export const DEFAULT_GENERATED_DISPLAY_PAIR = {
  frameBytes: 1_000,
  frameIntervalMs: 200,
} as const

export const COMPATIBLE_GENERATED_DISPLAY_PAIR = {
  frameBytes: 100,
  frameIntervalMs: 2_000,
} as const

export type GeneratedDisplayPair =
  | typeof DEFAULT_GENERATED_DISPLAY_PAIR
  | typeof COMPATIBLE_GENERATED_DISPLAY_PAIR

export interface Preferences {
  defaultAlgorithm: UiAlgorithm
  defaultPqProfile: PqProfileId
  // VITE_REQUIRE_SIGNATURE=true from the environment is a floor the user cannot lower.
  requireSignature: boolean
  qrErrorCorrection: QrEcLevel
  autoClearPlaintextAfterEncrypt: boolean
  backgroundClearEnabled: boolean
  frameBytes: number // Generated 100–1000 in 100B steps; stored as one exact display pair.
  frameIntervalMs: number // Generated 200–1000ms plus 2000ms; stored as one exact display pair.
  transferTimeoutMinutes: number // Default 10.
  wipeOnOnline: boolean // Default true.
  resetChurnMb: number // 0–512, default 0 (experimental option).
}

// Defaults for v2 additions. Construct Preferences literals by spreading this value
// as the single source; preferences-repository / limits.ts validate numeric ranges.
export const PQ_PREFERENCE_DEFAULTS = {
  defaultPqProfile: "maximum",
  requireSignature: false,
  frameBytes: DEFAULT_GENERATED_DISPLAY_PAIR.frameBytes,
  frameIntervalMs: DEFAULT_GENERATED_DISPLAY_PAIR.frameIntervalMs,
  transferTimeoutMinutes: 10,
  wipeOnOnline: true,
  resetChurnMb: 0,
} as const satisfies Partial<Preferences>
