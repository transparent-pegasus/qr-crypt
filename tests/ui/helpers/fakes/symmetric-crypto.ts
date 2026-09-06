import { vi } from "vitest"
import { AppError } from "@/crypto/errors"
import type {
  StoredKeyRecord,
  SymMessageEnvelopeV2,
  SymmetricKeyEnvelopeV2,
} from "@/schemas/domain"
import { nextKeyCounter, resetFakeCounters } from "./counters"
import { cryptoKey, generatedFingerprint } from "./key-fixtures"
import { registerFakeReset } from "./reset"
import { setLastSymMessageEnvelope } from "./wire-state"

const encoder = new TextEncoder()
const symmetricFingerprintsByKeyId = new Map<string, string>()

export const sealSymMessage = vi.fn(
  async ({
    record,
    plaintext,
    now,
  }: {
    record: StoredKeyRecord
    plaintext: Uint8Array
    now: number
  }): Promise<SymMessageEnvelopeV2> => {
    const envelope: SymMessageEnvelopeV2 = {
      version: 2,
      type: "sym-message",
      suite: "HKDF-SHA256+A256GCM",
      keyId: record.id,
      createdAt: now,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array([...plaintext, ...new Uint8Array(16)]),
    }
    setLastSymMessageEnvelope(envelope)
    return envelope
  },
)
export const openSymMessage = vi.fn(async () =>
  encoder.encode("sym-v2復号済み平文"),
)
export const generateAesKey = vi.fn(async () => cryptoKey())

export const createSymmetricKeyRecord = vi.fn(
  async (name: string, now: number): Promise<StoredKeyRecord> => {
    const counter = nextKeyCounter()
    return {
      id: `G${String(counter).padStart(21, "0")}`,
      name,
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: generatedFingerprint(100 + counter),
      createdAt: now,
      useCount: 0,
      status: "active",
      symmetricKey: cryptoKey(),
    }
  },
)

async function defaultRotateSymmetricKeyRecord(
  current: StoredKeyRecord,
  now: number,
): Promise<{ next: StoredKeyRecord; previous: StoredKeyRecord }> {
  const created = await createSymmetricKeyRecord(current.name, now)
  return {
    next: { ...created, rotatedFromId: current.id },
    previous: { ...current, status: "rotated", rotatedAt: now },
  }
}

export const rotateSymmetricKeyRecord = vi.fn(
  defaultRotateSymmetricKeyRecord,
)
export const buildSymmetricKeyEnvelopeV2 = vi.fn(
  async (record: StoredKeyRecord): Promise<SymmetricKeyEnvelopeV2> => {
    if (record.status !== "active") {
      throw new AppError("KEY_TYPE_MISMATCH")
    }
    symmetricFingerprintsByKeyId.set(record.id, record.fingerprint)
    return {
      version: 2,
      type: "symmetric-key",
      algorithm: "A256GCM",
      keyId: record.id,
      createdAt: record.createdAt,
      key: new Uint8Array(32).fill(0x7c),
    }
  },
)
export const importSymmetricKeyRecordV2 = vi.fn(
  async (name: string, envelope: SymmetricKeyEnvelopeV2, now: number) => {
    const record: StoredKeyRecord = {
      id: envelope.keyId,
      name,
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint:
        symmetricFingerprintsByKeyId.get(envelope.keyId) ??
        generatedFingerprint(302),
      createdAt: now,
      useCount: 0,
      status: "active",
      symmetricKey: cryptoKey(),
    }
    envelope.key.fill(0)
    return record
  },
)

registerFakeReset(() => {
  symmetricFingerprintsByKeyId.clear()
  resetFakeCounters()
  rotateSymmetricKeyRecord.mockImplementation(
    defaultRotateSymmetricKeyRecord,
  )
})
