// ポスト量子 ID のライフサイクル(spec2 §8/§10 — WP-13)。
// シード生成・keygen・Vault 暗号化は Worker 内(generateIdentityKeys)。
// KEM シードと DSA シードは独立の CSPRNG 呼出であること(テストで相異確認)。
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import type {
  PostQuantumIdentity,
  PqProfileId,
  PublicIdentityBundleV2,
} from "@/schemas/domain"

export interface CreateIdentityArgs {
  client: PqCryptoClient
  vaultKey: CryptoKey
  name: string
  profile: PqProfileId // 初期リリースは balanced のみ UI 露出(plan2.1 §A)
  now: number
}

export function createIdentity(args: CreateIdentityArgs): Promise<PostQuantumIdentity> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-13 createIdentity")
}

// 旧世代は status="rotated"(復号/検証専用)で保持し、新世代を返す(plan2.1 §E1)
export interface RotateIdentityArgs {
  client: PqCryptoClient
  vaultKey: CryptoKey
  current: PostQuantumIdentity
  now: number
}

export interface RotatedIdentity {
  next: PostQuantumIdentity
  previous: PostQuantumIdentity // status を rotated へ更新した旧世代
}

export function rotateIdentity(args: RotateIdentityArgs): Promise<RotatedIdentity> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-13 rotateIdentity")
}

export function buildPublicBundle(
  identity: PostQuantumIdentity,
): PublicIdentityBundleV2 {
  void identity
  throw new Error("NOT_IMPLEMENTED: WP-13 buildPublicBundle")
}
