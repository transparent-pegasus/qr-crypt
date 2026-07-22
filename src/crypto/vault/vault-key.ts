// ローカル Vault 鍵(spec2 §9、WP-11)。非抽出 AES-256-GCM CryptoKey を
// appMetadata ストア(key: "vault-key")に保存する。
//
// 競合制約(plan2.1 §C8):
//   - 作成は cross-tab lock(navigator.locks、fallback あり)+ 単一 readwrite
//     transaction 内の「存在確認 → add」(put で上書きしない)
//   - 競合に敗けた側は生成した鍵を破棄し、保存済みの鍵を再読込する
//   - 上書きは回復不能な identity を作るため絶対に行わない
import type { EncryptedSecret } from "@/schemas/domain"

export const VAULT_KEY_METADATA_KEY = "vault-key"

export function getOrCreateVaultKey(): Promise<CryptoKey> {
  throw new Error("NOT_IMPLEMENTED: WP-11 getOrCreateVaultKey")
}

// WipeCoordinator(plan2.1 §B3)用: メモリー上の Vault 鍵参照・promise を破棄する
export function dropVaultKeyCache(): void {
  throw new Error("NOT_IMPLEMENTED: WP-11 dropVaultKeyCache")
}

// 暗号シュレッディング参照用の再輸出(vault 配下の EncryptedSecret 型)
export type { EncryptedSecret }
