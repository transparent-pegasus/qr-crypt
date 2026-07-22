// Vault シード暗号化(spec2 §9、WP-11)。AES-256-GCM(IV 12B CSPRNG)。
// AAD は buildVaultAadV2(plan2.1 §C8)— 用途ラベル単体は禁止。
// 暗号化後、平文シードは呼出側の責務で zeroize する。
import type { EncryptedSecret } from "@/schemas/domain"
import type { VaultAadFieldsV2 } from "@/crypto/pq/wire-bytes"

export interface EncryptSecretArgs {
  vaultKey: CryptoKey
  plaintextSecret: Uint8Array
  aad: VaultAadFieldsV2
}

export function encryptSecret(args: EncryptSecretArgs): Promise<EncryptedSecret> {
  void args
  throw new Error("NOT_IMPLEMENTED: WP-11 encryptSecret")
}
