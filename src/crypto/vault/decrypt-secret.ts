// Vault seed decryption. Fail closed (DECRYPTION_FAILED) on an
// AAD mismatch caused by record substitution or purpose confusion. After decryption,
// the required sequence is always:
// "regenerate public key with keygen → exact match with stored public key → sign/decaps → zeroize".
import type { EncryptedSecret } from "@/schemas/domain"
import type { VaultAadFieldsV2 } from "@/crypto/pq/wire-bytes"
import { buildVaultAadV2, keyIdRawBytes } from "@/crypto/pq/wire-bytes"
import { AppError } from "@/crypto/errors"
import { isVaultKey } from "@/crypto/vault/is-vault-key"
import { toOwnedArrayBuffer } from "@/lib/bytes"
import { DSA_SEED_BYTES, IV_BYTES, KEM_SEED_BYTES } from "@/lib/limits"

export interface DecryptSecretArgs {
  vaultKey: CryptoKey
  secret: EncryptedSecret
  aad: VaultAadFieldsV2
}

export async function decryptSecret(args: DecryptSecretArgs): Promise<Uint8Array> {
  try {
    const expectedSeedLength =
      args.aad.role === "ml-kem-seed" ? KEM_SEED_BYTES : DSA_SEED_BYTES
    if (
      !isVaultKey(args.vaultKey) ||
      !(args.secret.iv instanceof Uint8Array) ||
      args.secret.iv.byteLength !== IV_BYTES ||
      !(args.secret.ciphertext instanceof Uint8Array) ||
      args.secret.ciphertext.byteLength !== expectedSeedLength + 16
    ) {
      throw new AppError("DECRYPTION_FAILED")
    }
    keyIdRawBytes(args.aad.identityId)
    keyIdRawBytes(args.aad.keyId)
    const additionalData = buildVaultAadV2(args.aad)
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(args.secret.iv),
          additionalData: toOwnedArrayBuffer(additionalData),
          tagLength: 128,
        },
        args.vaultKey,
        toOwnedArrayBuffer(args.secret.ciphertext),
      ),
    )
    if (plaintext.byteLength !== expectedSeedLength) {
      throw new AppError("DECRYPTION_FAILED")
    }
    return plaintext
  } catch {
    throw new AppError("DECRYPTION_FAILED")
  }
}
