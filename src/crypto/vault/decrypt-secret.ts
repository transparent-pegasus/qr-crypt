// Vault シード復号(spec2 §9、WP-11)。AAD 不一致(レコード差替え・用途違い)は
// fail-closed(DECRYPTION_FAILED)。復号後の利用手順は必ず
// 「keygen で公開鍵再生成 → 保存公開鍵と完全一致 → sign/decaps → zeroize」
// (plan2.1 §C8)。
import type { EncryptedSecret } from "@/schemas/domain"
import type { VaultAadFieldsV2 } from "@/crypto/pq/wire-bytes"

export interface DecryptSecretArgs {
  vaultKey: CryptoKey
  secret: EncryptedSecret
  aad: VaultAadFieldsV2
}

export function decryptSecret(args: DecryptSecretArgs): Promise<Uint8Array> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-11 decryptSecret")
}
