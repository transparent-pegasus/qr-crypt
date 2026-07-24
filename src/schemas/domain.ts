// 共有ドメイン型の単一所有元(plan §12-4/§12-9、v2: plan2.1 §H WP-A2)。依存ゼロ
// (import の追加は禁止 — UI テストのモジュールモックが循環するため)。
// UI 層の方式 ID とワイヤー(エンベロープ)の方式 ID は別物であり、
// 相互変換は必ずこのモジュールの mapper を通す(文字列直接比較の禁止)。
// v2 の suite 導出(resolveSuite/suiteComponents)は crypto/pq/suites.ts。

// ---------------------------------------------------------------------------
// 方式 ID(v1 A256GCM + v2 PQ)
// ---------------------------------------------------------------------------

export type UiAlgorithm = "A256GCM" | "MLKEM1024_A256GCM" | "MLKEM1024_MLDSA87_A256GCM"

export type WireAlgorithm = "A256GCM"

export type QrEcLevel = "L" | "M" | "Q" | "H"

export type KeyKind = "symmetric" | "rsa-key-pair" | "public-key"

export interface StoredKeyRecord {
  id: string
  name: string
  kind: KeyKind
  algorithm: string
  fingerprint: string
  createdAt: number
  lastUsedAt?: number
  useCount: number
  publicKey?: CryptoKey
  privateKey?: CryptoKey
  symmetricKey?: CryptoKey
}

// v1 A256GCM ワイヤー専用 mapper。PQ 方式のワイヤー解決は crypto/pq/suites.ts の
// resolveSuite を使う(本モジュールは依存ゼロのため AppError を投げられない)。
export function toWireAlgorithm(algorithm: UiAlgorithm): WireAlgorithm {
  if (algorithm === "A256GCM") return "A256GCM"
  throw new TypeError("v2 algorithm requires resolveSuite (crypto/pq/suites)")
}

export function toUiAlgorithm(algorithm: WireAlgorithm): UiAlgorithm {
  return algorithm
}

// ---------------------------------------------------------------------------
// v2 ポスト量子 — アルゴリズム・スイート(spec2 §1/§2/§7、plan2.1 §C1)
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
// v2 Vault(spec2 §9、plan2.1 §C8)
// ---------------------------------------------------------------------------

export interface EncryptedSecret {
  iv: Uint8Array
  ciphertext: Uint8Array
}

export type VaultSecretRole = "ml-kem-seed" | "ml-dsa-seed"

// ---------------------------------------------------------------------------
// v2 ポスト量子 ID(spec2 §8、plan2.1 §E1)
// ---------------------------------------------------------------------------

// active: 暗号化・署名に使用可 / rotated: 復号・検証専用(旧世代) /
// revoked: この端末で利用停止(復号のみ許可。外部への失効伝播はしない)
export type PqKeyStatus = "active" | "rotated" | "revoked"

export interface PqKemKeyMaterial {
  algorithm: MlKemAlgorithm
  keyId: string // 16B 乱数の base64url 22 文字(KEY_ID_PATTERN)
  publicKey: Uint8Array
  encryptedSeed: EncryptedSecret // 64B シードの Vault 暗号化(AAD = buildVaultAadV2)
  fingerprint: string // pqKeyFingerprint("kem", ...) の sha256 hex
}

export interface PqSigningKeyMaterial {
  algorithm: MlDsaAlgorithm
  keyId: string
  publicKey: Uint8Array
  encryptedSeed: EncryptedSecret // 32B シード。KEM シードとは独立の CSPRNG 呼出
  fingerprint: string
}

// pqIdentities ストアのレコード(keyPath: id)。
// ローテーションは identity 単位: 新世代を新 id・新 keyId で作成し、
// 旧世代 row は status="rotated"(復号/検証専用)として保持する。
export interface PostQuantumIdentity {
  id: string
  name: string
  profile: PqProfileId
  kem: PqKemKeyMaterial
  signing: PqSigningKeyMaterial
  identityFingerprint: string // name を除く公開タプルへの指紋(plan2.1 §E5)
  status: PqKeyStatus
  rotatedFromId?: string // 旧世代 identity の id(lineage)
  rotatedAt?: number
  revokedAt?: number
  createdAt: number
  lastUsedAt?: number
}

// ---------------------------------------------------------------------------
// v2 公開鍵セット(spec2 §10)と取込レコード(plan2.1 §E2/§E5)
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

// pqPublicBundles ストアのレコード(keyPath: recordId)。
// identityId は送信者申告値のため unique にしない(by-identityId は non-unique)。
export interface PqPublicBundleRecord {
  recordId: string
  identityId: string
  name?: string // bundle 由来の未認証表示名。trusted 表示に単独で使わない
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
  revokedAt?: number // ローカル利用停止(外部へ伝播しない)
  bundleCreatedAt: number // wire の createdAt(端末申告時刻・信頼時刻ではない)
  importedAt: number
  lastUsedAt?: number
}

// ---------------------------------------------------------------------------
// v2 内部メッセージ(spec2 §6、plan2.1 §C3: strict discriminated union)
// ---------------------------------------------------------------------------

export interface MessageBodyCommonV2 {
  version: 2
  messageId: Uint8Array // CSPRNG 16B 固定長。リプレイ防止機構ではない(§G)
  createdAt: number // 端末申告時刻(信頼時刻ではない)
  recipientKemKeyId: string
  plaintext: Uint8Array
}

// unsigned では senderSigningKeyId を空文字ではなく「キーごと省略」する(U29)
export type UnsignedMessageBodyV2 = MessageBodyCommonV2

export interface SignedMessageBodyV2 extends MessageBodyCommonV2 {
  senderSigningKeyId: string
}

// kind はメモリー内判別子。ワイヤー CBOR には載せない(外側 suite が権威)。
// ワイヤー形状: unsigned suite → UnsignedMessageBodyV2 の map 単体 /
// signed suite → { body, signature } の map(docs/qr-protocol-v2.md §5)。
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
// v2 外部エンベロープと AAD(spec2 §7)
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
  kemCiphertextSha256: Uint8Array // 受信側は受信 kemCiphertext から再計算し一致検証
}

// ---------------------------------------------------------------------------
// v2 復号結果(plan2.1 §C2)。signed-key-unknown に plaintext プロパティは無い
// (構築自体を型で禁止する)。senderSigningKeyId は署名鍵取込導線用。
// ---------------------------------------------------------------------------

export type PqDecryptResult =
  | { kind: "unsigned"; plaintext: Uint8Array }
  | { kind: "signed-valid"; plaintext: Uint8Array; senderSigningKeyId: string }
  | { kind: "signed-key-unknown"; senderSigningKeyId: string }

// ---------------------------------------------------------------------------
// v2 複数 QR フレーム(spec2 §12、plan2.1 §D)
// ---------------------------------------------------------------------------

// OCP2/OCS2(単鍵)もフレーミングして運ぶため、spec2 §12 の 3 値へ
// pq-kem-public-key / pq-dsa-public-key を管理された追加として拡張する
// (docs/qr-protocol-v2.md §6、README 逸脱表)。
export const V2_ARTIFACT_TYPES = [
  "pq-message",
  "pq-public-identity",
  "pq-kem-public-key",
  "pq-dsa-public-key",
  "encrypted-seed-backup",
] as const
export type V2ArtifactType = (typeof V2_ARTIFACT_TYPES)[number]
export type StorablePqArtifactKind = Exclude<
  V2ArtifactType,
  "pq-message" | "encrypted-seed-backup"
>

export interface QrFrameV2 {
  version: 2
  type: "qr-frame"
  transferId: Uint8Array // 16B 乱数
  artifactType: V2ArtifactType
  frameIndex: number // 0 起点(0..frameCount-1)
  frameCount: number // 1..PROTOCOL_MAX_FRAMES(64)
  totalByteLength: number // artifact CBOR 生バイト長の合計
  payloadSha256: Uint8Array // artifact CBOR 生バイトへの SHA-256(転送整合性)
  chunk: Uint8Array // artifact CBOR 生バイトの分割片(二重 base64url 禁止 §D1)
}

// ---------------------------------------------------------------------------
// v2 単鍵公開鍵エンベロープ(OCP2/OCS2。spec2 §11 の論理型を型として固定)
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
// 設定(plan2.1 §I。theme は v1 同様 localStorage "oc-theme" 所有で DB 外)
// ---------------------------------------------------------------------------

export interface Preferences {
  defaultAlgorithm: UiAlgorithm
  defaultPqProfile: PqProfileId
  // env の VITE_REQUIRE_SIGNATURE=true は floor(利用者は下げられない)
  requireSignature: boolean
  qrErrorCorrection: QrEcLevel
  autoClearPlaintextAfterEncrypt: boolean
  backgroundClearEnabled: boolean
  frameBytes: number // 400–900(limits.ts が単一導出元)
  frameIntervalMs: number // 150–2000
  transferTimeoutMinutes: number // 既定 10
  wipeOnOnline: boolean // 既定 true(オーナー要件。plan2.1 §B5)
  resetChurnMb: number // 0–512・既定 0(実験オプション。plan2.1 §B4)
}

// v2 追加フィールドの既定値。Preferences リテラルはこれを spread して構築する
// (単一導出元。数値範囲の検証は preferences-repository / limits.ts)。
export const PQ_PREFERENCE_DEFAULTS = {
  defaultPqProfile: "maximum",
  requireSignature: false,
  frameBytes: 600,
  frameIntervalMs: 800,
  transferTimeoutMinutes: 10,
  wipeOnOnline: true,
  resetChurnMb: 0,
} as const satisfies Partial<Preferences>
