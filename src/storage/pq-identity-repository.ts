// pqIdentities ストアの CRUD(plan2.1 §E1/§E2 — WP-13)。
// keyPath: id / index: by-createdAt, by-kemKeyId, by-signingKeyId。
//
// 選択規則(plan2.1 §E1・凍結):
//   - 復号: rotated 含む全 non-destroyed を kem.keyId で探索
//   - 署名: status="active" の signing のみ(revoked/rotated は署名不可)
//   - 展開済み秘密鍵は絶対に永続化しない(シードの EncryptedSecret のみ)
import type { PostQuantumIdentity } from "@/schemas/domain"

export function listIdentities(): Promise<PostQuantumIdentity[]> {
  throw new Error("NOT_IMPLEMENTED: WP-13 listIdentities")
}

export function getIdentity(id: string): Promise<PostQuantumIdentity | undefined> {
  void id
  throw new Error("NOT_IMPLEMENTED: WP-13 getIdentity")
}

export function findIdentityByKemKeyId(
  kemKeyId: string,
): Promise<PostQuantumIdentity | undefined> {
  void kemKeyId
  throw new Error("NOT_IMPLEMENTED: WP-13 findIdentityByKemKeyId")
}

export function findIdentityBySigningKeyId(
  signingKeyId: string,
): Promise<PostQuantumIdentity | undefined> {
  void signingKeyId
  throw new Error("NOT_IMPLEMENTED: WP-13 findIdentityBySigningKeyId")
}

export function saveIdentity(identity: PostQuantumIdentity): Promise<void> {
  void identity
  throw new Error("NOT_IMPLEMENTED: WP-13 saveIdentity")
}

// ローテーション(rotateIdentity の結果 2 行を単一 transaction で保存)
export function saveRotation(args: {
  next: PostQuantumIdentity
  previous: PostQuantumIdentity
}): Promise<void> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-13 saveRotation")
}

export function revokeIdentity(id: string, revokedAt: number): Promise<void> {
  void id
  void revokedAt
  throw new Error("NOT_IMPLEMENTED: WP-13 revokeIdentity")
}

export function deleteIdentity(id: string): Promise<void> {
  void id
  throw new Error("NOT_IMPLEMENTED: WP-13 deleteIdentity")
}

export function markIdentityUsed(id: string, usedAt: number): Promise<void> {
  void id
  void usedAt
  throw new Error("NOT_IMPLEMENTED: WP-13 markIdentityUsed")
}
