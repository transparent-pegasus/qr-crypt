// Vault シード暗号化(spec2 §9、WP-11)。AES-256-GCM(IV 12B CSPRNG)。
// AAD は buildVaultAadV2(plan2.1 §C8)— 用途ラベル単体は禁止。
// 暗号化後、平文シードは呼出側の責務で zeroize する。
import type { EncryptedSecret } from "@/schemas/domain"
import type { VaultAadFieldsV2 } from "@/crypto/pq/wire-bytes"
import { buildVaultAadV2, keyIdRawBytes } from "@/crypto/pq/wire-bytes"
import { AppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import { toOwnedArrayBuffer } from "@/lib/bytes"
import { DSA_SEED_BYTES, IV_BYTES, KEM_SEED_BYTES } from "@/lib/limits"

export interface EncryptSecretArgs {
  vaultKey: CryptoKey
  plaintextSecret: Uint8Array
  aad: VaultAadFieldsV2
}

function validVaultKey(key: CryptoKey): boolean {
  const algorithm = key.algorithm as Partial<AesKeyAlgorithm>
  return (
    key.type === "secret" &&
    key.extractable === false &&
    algorithm.name === "AES-GCM" &&
    algorithm.length === 256 &&
    key.usages.includes("encrypt")
  )
}

export async function encryptSecret(args: EncryptSecretArgs): Promise<EncryptedSecret> {
  try {
    const expectedLength =
      args.aad.role === "ml-kem-seed" ? KEM_SEED_BYTES : DSA_SEED_BYTES
    if (
      !validVaultKey(args.vaultKey) ||
      !(args.plaintextSecret instanceof Uint8Array) ||
      args.plaintextSecret.byteLength !== expectedLength
    ) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    keyIdRawBytes(args.aad.identityId)
    keyIdRawBytes(args.aad.keyId)
    const iv = randomBytes(IV_BYTES)
    const additionalData = buildVaultAadV2(args.aad)
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(iv),
          additionalData: toOwnedArrayBuffer(additionalData),
          tagLength: 128,
        },
        args.vaultKey,
        toOwnedArrayBuffer(args.plaintextSecret),
      ),
    )
    return { iv, ciphertext }
  } catch {
    throw new AppError("ENCRYPTION_FAILED")
  }
}
