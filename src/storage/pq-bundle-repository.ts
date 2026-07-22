// pqPublicBundles ストアの CRUD(plan2.1 §E2/§E5 — WP-13)。
// keyPath: recordId / index: by-identityId(non-unique)。
//
// 規則(凍結):
//   - 暗号化の受信者選択は revokedAt 無しのレコードのみ
//   - 署名検証鍵の解決は signing.keyId で全レコード探索(revoked は未知鍵扱い)
//   - trust("unverified" | "fingerprint-confirmed")の遷移は
//     指紋比較画面の確認操作のみが行う(取込時は必ず unverified)
import type { PqPublicBundleRecord } from "@/schemas/domain"

export function listBundles(): Promise<PqPublicBundleRecord[]> {
  throw new Error("NOT_IMPLEMENTED: WP-13 listBundles")
}

export function getBundle(recordId: string): Promise<PqPublicBundleRecord | undefined> {
  void recordId
  throw new Error("NOT_IMPLEMENTED: WP-13 getBundle")
}

export function findBundleBySigningKeyId(
  signingKeyId: string,
): Promise<PqPublicBundleRecord | undefined> {
  void signingKeyId
  throw new Error("NOT_IMPLEMENTED: WP-13 findBundleBySigningKeyId")
}

export function findBundleByKemKeyId(
  kemKeyId: string,
): Promise<PqPublicBundleRecord | undefined> {
  void kemKeyId
  throw new Error("NOT_IMPLEMENTED: WP-13 findBundleByKemKeyId")
}

export function saveBundle(record: PqPublicBundleRecord): Promise<void> {
  void record
  throw new Error("NOT_IMPLEMENTED: WP-13 saveBundle")
}

export function confirmBundleFingerprint(
  recordId: string,
  confirmedAt: number,
): Promise<void> {
  void recordId
  void confirmedAt
  throw new Error("NOT_IMPLEMENTED: WP-13 confirmBundleFingerprint")
}

export function revokeBundle(recordId: string, revokedAt: number): Promise<void> {
  void recordId
  void revokedAt
  throw new Error("NOT_IMPLEMENTED: WP-13 revokeBundle")
}

export function deleteBundle(recordId: string): Promise<void> {
  void recordId
  throw new Error("NOT_IMPLEMENTED: WP-13 deleteBundle")
}

export function markBundleUsed(recordId: string, usedAt: number): Promise<void> {
  void recordId
  void usedAt
  throw new Error("NOT_IMPLEMENTED: WP-13 markBundleUsed")
}
