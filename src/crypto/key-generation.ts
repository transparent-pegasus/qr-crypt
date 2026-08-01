// High-level API that packages key generation and import into StoredKeyRecord.
// It does not persist records; storage/key-repository owns persistence.
import type { SymmetricKeyEnvelopeV1 } from "@/crypto/envelope"
import type { StoredKeyRecord, SymmetricKeyEnvelopeV2 } from "@/schemas/domain"
import { generateAesKey } from "@/crypto/aes-gcm"
import { AppError, toAppError } from "@/crypto/errors"
import { fingerprintAesKey } from "@/crypto/fingerprint"
import { exportAesKeyRaw, importAesKeyRaw } from "@/crypto/key-import-export"
import { validateSymmetricKeyEnvelopeV2 } from "@/crypto/pq/validation"
import { zeroize } from "@/crypto/pq/zeroize"
import { generateKeyId } from "@/crypto/random"
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
    return {
      id: generateKeyId(),
      name: normalizedName(name),
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: await fingerprintAesKey(symmetricKey),
      createdAt: now,
      useCount: 0,
      status: "active",
      symmetricKey,
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
    return {
      id: envelope.keyId,
      name: normalizedName(name),
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: await fingerprintAesKey(symmetricKey),
      createdAt: now,
      useCount: 0,
      status: "active",
      symmetricKey,
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

export async function importSymmetricKeyRecordV2(
  name: string,
  envelope: SymmetricKeyEnvelopeV2,
  now: number,
): Promise<StoredKeyRecord> {
  try {
    if (!validTimestamp(now)) throw new AppError("STORAGE_FAILED")
    const validated = validateSymmetricKeyEnvelopeV2(envelope)
    const symmetricKey = await importAesKeyRaw(validated.key)
    return {
      id: validated.keyId,
      name: normalizedName(name),
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: await fingerprintAesKey(symmetricKey),
      createdAt: now,
      useCount: 0,
      status: "active",
      symmetricKey,
    }
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  } finally {
    zeroize(envelope.key)
  }
}

export async function buildSymmetricKeyEnvelopeV2(
  record: StoredKeyRecord,
): Promise<SymmetricKeyEnvelopeV2> {
  try {
    if (
      record.kind !== "symmetric" ||
      record.status !== "active" ||
      record.symmetricKey === undefined
    ) {
      throw new AppError("KEY_TYPE_MISMATCH")
    }
    return {
      version: 2,
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
