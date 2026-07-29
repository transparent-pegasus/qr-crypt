// Vault seed encryption uses AES-256-GCM with a 12B CSPRNG IV.
// AAD must come from buildVaultAadV2; a purpose label alone is prohibited.
// After encryption, the caller is responsible for zeroizing the plaintext seed.
import type { EncryptedSecret } from "@/schemas/domain"
import type { VaultAadFieldsV2 } from "@/crypto/pq/wire-bytes"
import { buildVaultAadV2, keyIdRawBytes } from "@/crypto/pq/wire-bytes"
import { AppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import { isVaultKey } from "@/crypto/vault/is-vault-key"
import { toOwnedArrayBuffer } from "@/lib/bytes"
import { DSA_SEED_BYTES, IV_BYTES, KEM_SEED_BYTES } from "@/lib/limits"

export interface EncryptSecretArgs {
  vaultKey: CryptoKey
  plaintextSecret: Uint8Array
  aad: VaultAadFieldsV2
}

export async function encryptSecret(args: EncryptSecretArgs): Promise<EncryptedSecret> {
  try {
    const expectedLength =
      args.aad.role === "ml-kem-seed" ? KEM_SEED_BYTES : DSA_SEED_BYTES
    if (
      !isVaultKey(args.vaultKey) ||
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
