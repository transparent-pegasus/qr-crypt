// 共有ドメイン型の単一所有元(plan §12-4/§12-9)。依存ゼロ。
// UI 層の方式 ID とワイヤー(エンベロープ)の方式 ID は別物であり、
// 相互変換は必ずこのモジュールの mapper を通す(文字列直接比較の禁止)。

export type UiAlgorithm = "A256GCM" | "RSA-HYBRID"
export type WireAlgorithm = "A256GCM" | "RSA-OAEP-3072+A256GCM"

export type QrEcLevel = "L" | "M" | "Q" | "H"

export type KeyKind = "symmetric" | "rsa-key-pair" | "public-key"

export type QrArtifactKind =
  | "ciphertext"
  | "symmetric-key"
  | "public-key"
  | "encrypted-private-key"

export type Sensitivity = "public" | "confidential" | "secret"

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

export interface StoredQrArtifact {
  id: string
  name: string
  kind: QrArtifactKind
  sensitivity: Sensitivity
  algorithm: string
  payload: string
  payloadSha256: string
  byteLength: number
  createdAt: number
  // spec §14 の一覧表示要件(鍵IDまたは受信者鍵ID)のための拡張
  keyId?: string
  lastViewedAt?: number
}

export interface Preferences {
  defaultAlgorithm: UiAlgorithm
  qrErrorCorrection: QrEcLevel
  autoClearPlaintextAfterEncrypt: boolean
  backgroundClearSeconds: number
}

export function toWireAlgorithm(algorithm: UiAlgorithm): WireAlgorithm {
  return algorithm === "A256GCM" ? "A256GCM" : "RSA-OAEP-3072+A256GCM"
}

export function toUiAlgorithm(algorithm: WireAlgorithm): UiAlgorithm {
  return algorithm === "A256GCM" ? "A256GCM" : "RSA-HYBRID"
}

export function sensitivityForKind(kind: QrArtifactKind): Sensitivity {
  switch (kind) {
    case "public-key":
      return "public"
    case "ciphertext":
      return "confidential"
    case "symmetric-key":
    case "encrypted-private-key":
      return "secret"
  }
}
