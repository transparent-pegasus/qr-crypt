// High-level API that packages key generation and import into StoredKeyRecord.
// It does not persist records; storage/key-repository owns persistence.
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
      rotatedAt: undefined,
      symmetricKey,
    }
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

export interface RotatedSymmetricKey {
  next: StoredKeyRecord
  previous: StoredKeyRecord
}

export async function rotateSymmetricKeyRecord(
  current: StoredKeyRecord,
  now: number,
): Promise<RotatedSymmetricKey> {
  try {
    if (
      current.status !== "active" ||
      now < current.createdAt
    ) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    const created = await createSymmetricKeyRecord(current.name, now)
    return {
      next: { ...created, rotatedFromId: current.id },
      previous: { ...current, status: "rotated", rotatedAt: now },
    }
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

export function groupSymmetricKeys(
  records: StoredKeyRecord[],
): { head: StoredKeyRecord; previous: StoredKeyRecord[] }[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  const superseded = new Set(
    records
      .map((record) => record.rotatedFromId)
      .filter((id): id is string => id !== undefined),
  )
  return records
    .filter((record) => !superseded.has(record.id))
    .map((head) => {
      const previous: StoredKeyRecord[] = []
      const visited = new Set([head.id])
      for (let cursor = head.rotatedFromId; cursor !== undefined;) {
        const generation = byId.get(cursor)
        if (generation === undefined || visited.has(generation.id)) break
        visited.add(generation.id)
        previous.push(generation)
        cursor = generation.rotatedFromId
      }
      return { head, previous }
    })
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
      rotatedAt: undefined,
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
      record.status !== "active"
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
