// 鍵の生成・取込を StoredKeyRecord へ束ねる高レベル API(永続化はしない —
// 保存は storage/key-repository の責務)。
import type { PublicKeyEnvelopeV1, SymmetricKeyEnvelopeV1 } from "@/crypto/envelope"
import type { StoredKeyRecord } from "@/schemas/domain"
import { generateAesKey } from "@/crypto/aes-gcm"
import { AppError, toAppError } from "@/crypto/errors"
import { fingerprintAesKey, fingerprintPublicKey } from "@/crypto/fingerprint"
import {
  exportAesKeyRaw,
  exportPublicKeySpki,
  importAesKeyRaw,
  importPublicKeySpki,
} from "@/crypto/key-import-export"
import { generateKeyId } from "@/crypto/random"
import { generateRsaKeyPair } from "@/crypto/rsa-hybrid"
import { keyNameSchema } from "@/schemas/key-schema"

function validTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function normalizedName(name: string): string {
  const parsed = keyNameSchema.safeParse(name)
  if (!parsed.success) throw new AppError("STORAGE_FAILED")
  return parsed.data
}

export async function createSymmetricKeyRecord(
  name: string,
  now: number,
): Promise<StoredKeyRecord> {
  try {
    if (!validTimestamp(now)) throw new AppError("STORAGE_FAILED")
    const symmetricKey = await generateAesKey()
    const fingerprint = await fingerprintAesKey(symmetricKey)
    return {
      id: generateKeyId(),
      name: normalizedName(name),
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: fingerprint.sha256Hex,
      createdAt: now,
      useCount: 0,
      symmetricKey,
    }
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

export async function createRsaKeyPairRecord(
  name: string,
  now: number,
): Promise<StoredKeyRecord> {
  try {
    if (!validTimestamp(now)) throw new AppError("STORAGE_FAILED")
    const pair = await generateRsaKeyPair()
    const fingerprint = await fingerprintPublicKey(pair.publicKey)
    return {
      id: generateKeyId(),
      name: normalizedName(name),
      kind: "rsa-key-pair",
      algorithm: "RSA-OAEP-3072",
      fingerprint: fingerprint.sha256Hex,
      createdAt: now,
      useCount: 0,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    }
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

export async function importSymmetricKeyRecord(
  name: string,
  envelope: SymmetricKeyEnvelopeV1,
  now: number,
): Promise<StoredKeyRecord> {
  try {
    if (!validTimestamp(now)) throw new AppError("STORAGE_FAILED")
    const symmetricKey = await importAesKeyRaw(envelope.key)
    const fingerprint = await fingerprintAesKey(symmetricKey)
    return {
      id: envelope.keyId,
      name: normalizedName(name),
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: fingerprint.sha256Hex,
      createdAt: now,
      useCount: 0,
      symmetricKey,
    }
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}

export async function importPublicKeyRecord(
  name: string,
  envelope: PublicKeyEnvelopeV1,
  now: number,
): Promise<StoredKeyRecord> {
  try {
    if (!validTimestamp(now)) throw new AppError("STORAGE_FAILED")
    const publicKey = await importPublicKeySpki(envelope.spki)
    const fingerprint = await fingerprintPublicKey(publicKey)
    return {
      id: envelope.keyId,
      name: normalizedName(name),
      kind: "public-key",
      algorithm: "RSA-OAEP-3072",
      fingerprint: fingerprint.sha256Hex,
      createdAt: now,
      useCount: 0,
      publicKey,
    }
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}

export async function buildSymmetricKeyEnvelope(
  record: StoredKeyRecord,
): Promise<SymmetricKeyEnvelopeV1> {
  try {
    if (record.kind !== "symmetric" || record.symmetricKey === undefined) {
      throw new AppError("KEY_TYPE_MISMATCH")
    }
    return {
      v: 1,
      type: "symmetric-key",
      algorithm: "A256GCM",
      keyId: record.id,
      createdAt: record.createdAt,
      key: await exportAesKeyRaw(record.symmetricKey),
    }
  } catch (error) {
    throw toAppError(error, "KEY_TYPE_MISMATCH")
  }
}

export async function buildPublicKeyEnvelope(
  record: StoredKeyRecord,
): Promise<PublicKeyEnvelopeV1> {
  try {
    if (
      (record.kind !== "rsa-key-pair" && record.kind !== "public-key") ||
      record.publicKey === undefined
    ) {
      throw new AppError("KEY_TYPE_MISMATCH")
    }
    return {
      v: 1,
      type: "public-key",
      algorithm: "RSA-OAEP-3072",
      keyId: record.id,
      createdAt: record.createdAt,
      spki: await exportPublicKeySpki(record.publicKey),
    }
  } catch (error) {
    throw toAppError(error, "KEY_TYPE_MISMATCH")
  }
}
