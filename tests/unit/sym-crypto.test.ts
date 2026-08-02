import { afterEach, describe, expect, it, vi } from "vitest"
import { openSymMessage, sealSymMessage } from "@/crypto/aes-gcm"
import { AppError } from "@/crypto/errors"
import { fingerprintAesKey } from "@/crypto/fingerprint"
import {
  buildSymmetricKeyEnvelopeV2,
  createSymmetricKeyRecord,
  groupSymmetricKeys,
  importSymmetricKeyRecordV2,
  rotateSymmetricKeyRecord,
} from "@/crypto/key-generation"
import { sha256Hex, utf8ToBytes } from "@/lib/bytes"
import {
  AES_GCM_TAG_BYTES,
  AES_KEY_BYTES,
  IV_BYTES,
  MAX_SYM_PLAINTEXT_BYTES,
} from "@/lib/limits"
import { validateStoredKeyRecord } from "@/schemas/key-schema"
import type {
  StoredKeyRecord,
  SymMessageEnvelopeV2,
} from "@/schemas/domain"

const NOW = 1_700_000_000_000

function changed(bytes: Uint8Array, index = 0): Uint8Array {
  const copy = Uint8Array.from(bytes)
  copy[index] = copy[index]! ^ 1
  return copy
}

function cloneEnvelope(envelope: SymMessageEnvelopeV2): SymMessageEnvelopeV2 {
  return {
    ...envelope,
    iv: Uint8Array.from(envelope.iv),
    ciphertext: Uint8Array.from(envelope.ciphertext),
  }
}

function changedKeyId(keyId: string): string {
  return `${keyId[0] === "A" ? "B" : "A"}${keyId.slice(1)}`
}

async function expectDecryptionFailed(operation: Promise<unknown>): Promise<void> {
  const error: unknown = await operation.then(
    () => {
      throw new Error("expected decryption to fail")
    },
    (reason: unknown) => reason,
  )

  expect(error).toBeInstanceOf(AppError)
  expect(error).toMatchObject({
    code: "DECRYPTION_FAILED",
    message: "DECRYPTION_FAILED",
  })
}

async function sealedFixture(): Promise<{
  record: StoredKeyRecord
  plaintext: Uint8Array
  envelope: SymMessageEnvelopeV2
}> {
  const record = await createSymmetricKeyRecord("shared key", NOW)
  const plaintext = utf8ToBytes("authenticated symmetric message 🔐")
  const envelope = await sealSymMessage({ record, plaintext, now: NOW + 1 })
  return { record, plaintext, envelope }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("sym-v2 sealing and opening", () => {
  it.each([
    ["empty", new Uint8Array()],
    ["Unicode", utf8ToBytes("暗号化する QR 📱")],
    ["maximum-length", new Uint8Array(MAX_SYM_PLAINTEXT_BYTES).fill(0x61)],
  ])("round-trips %s plaintext", async (_name, plaintext) => {
    const record = await createSymmetricKeyRecord("round trip", NOW)
    const envelope = await sealSymMessage({ record, plaintext, now: NOW + 1 })

    expect(await openSymMessage({ record, envelope })).toEqual(plaintext)
  })

  it("uses a fresh IV for every seal", async () => {
    const record = await createSymmetricKeyRecord("fresh randomness", NOW)
    const plaintext = utf8ToBytes("same plaintext")
    const first = await sealSymMessage({ record, plaintext, now: NOW + 1 })
    const second = await sealSymMessage({ record, plaintext, now: NOW + 1 })

    expect(first.iv).toHaveLength(IV_BYTES)
    expect(second.iv).toHaveLength(IV_BYTES)
    expect(second.iv).not.toEqual(first.iv)
  })

  it.each([
    [
      "createdAt",
      (envelope: SymMessageEnvelopeV2): SymMessageEnvelopeV2 => ({
        ...cloneEnvelope(envelope),
        createdAt: envelope.createdAt + 1,
      }),
    ],
    [
      "key ID",
      (envelope: SymMessageEnvelopeV2): SymMessageEnvelopeV2 => ({
        ...cloneEnvelope(envelope),
        keyId: changedKeyId(envelope.keyId),
      }),
    ],
  ] as const)("collapses a flipped %s to DECRYPTION_FAILED", async (_name, tamper) => {
    const { record, envelope } = await sealedFixture()

    await expectDecryptionFailed(
      openSymMessage({ record, envelope: tamper(envelope) }),
    )
  })

  it("collapses a wrong cryptographic key to DECRYPTION_FAILED", async () => {
    const { record, envelope } = await sealedFixture()
    const other = await createSymmetricKeyRecord("wrong key", NOW)
    const wrongKeyRecord: StoredKeyRecord = {
      ...other,
      id: record.id,
    }

    await expectDecryptionFailed(
      openSymMessage({ record: wrongKeyRecord, envelope }),
    )
  })

  it.each([
    [
      "truncated tag",
      (ciphertext: Uint8Array) => ciphertext.slice(0, -1),
    ],
    [
      "tampered tag",
      (ciphertext: Uint8Array) => changed(ciphertext, ciphertext.byteLength - 1),
    ],
  ] as const)("collapses a %s to DECRYPTION_FAILED", async (_name, tamper) => {
    const { record, envelope } = await sealedFixture()

    await expectDecryptionFailed(
      openSymMessage({
        record,
        envelope: { ...cloneEnvelope(envelope), ciphertext: tamper(envelope.ciphertext) },
      }),
    )
  })

  it.each([
    ["short IV", "iv", IV_BYTES - 1],
    ["long IV", "iv", IV_BYTES + 1],
  ] as const)("collapses a %s to DECRYPTION_FAILED", async (_name, field, length) => {
    const { record, envelope } = await sealedFixture()
    const invalid: SymMessageEnvelopeV2 = {
      ...cloneEnvelope(envelope),
      [field]: new Uint8Array(length),
    }

    await expectDecryptionFailed(openSymMessage({ record, envelope: invalid }))
  })

  it.each([
    ["ciphertext shorter than a GCM tag", AES_GCM_TAG_BYTES - 1],
    [
      "ciphertext above the symmetric plaintext ceiling",
      MAX_SYM_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES + 1,
    ],
  ])("collapses %s to DECRYPTION_FAILED", async (_name, length) => {
    const { record, envelope } = await sealedFixture()
    const invalid = {
      ...cloneEnvelope(envelope),
      ciphertext: new Uint8Array(length),
    }

    await expectDecryptionFailed(openSymMessage({ record, envelope: invalid }))
  })

  it("rejects plaintext above the single-frame ceiling with ENCRYPTION_FAILED", async () => {
    const record = await createSymmetricKeyRecord("oversize", NOW)

    await expect(
      sealSymMessage({
        record,
        plaintext: new Uint8Array(MAX_SYM_PLAINTEXT_BYTES + 1),
        now: NOW + 1,
      }),
    ).rejects.toMatchObject({
      code: "ENCRYPTION_FAILED",
      message: "ENCRYPTION_FAILED",
    })
  })

  it("blocks sealing after rotation but still opens a message sealed before it", async () => {
    const { record, plaintext, envelope } = await sealedFixture()
    const { previous } = await rotateSymmetricKeyRecord(record, NOW + 2)

    await expect(
      sealSymMessage({ record: previous, plaintext, now: NOW + 3 }),
    ).rejects.toMatchObject({
      code: "ENCRYPTION_FAILED",
      message: "ENCRYPTION_FAILED",
    })
    expect(await openSymMessage({ record: previous, envelope })).toEqual(plaintext)
  })

  it("derives a non-extractable message key", async () => {
    const record = await createSymmetricKeyRecord("non-extractable", NOW)
    const deriveKeySpy = vi.spyOn(crypto.subtle, "deriveKey")

    await sealSymMessage({
      record,
      plaintext: utf8ToBytes("derived key probe"),
      now: NOW + 1,
    })

    expect(deriveKeySpy).toHaveBeenCalledTimes(1)
    expect(deriveKeySpy.mock.calls[0]?.[3]).toBe(false)
    const result = deriveKeySpy.mock.results[0]
    if (result?.type !== "return") throw new Error("deriveKey did not return a key")
    const derivedKey = await result.value
    expect(derivedKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey("raw", derivedKey)).rejects.toThrow()
  })
})

describe("symmetric key rotation", () => {
  it("creates a new active key and marks its predecessor rotated", async () => {
    const current = await createSymmetricKeyRecord("lineage name", NOW)

    const { next, previous } = await rotateSymmetricKeyRecord(current, NOW + 1)

    expect(next).toMatchObject({
      name: current.name,
      kind: "symmetric",
      algorithm: "A256GCM",
      createdAt: NOW + 1,
      useCount: 0,
      status: "active",
      rotatedFromId: current.id,
    })
    expect(next.id).not.toBe(current.id)
    expect(next.fingerprint).not.toBe(current.fingerprint)
    expect(next.symmetricKey).not.toBe(current.symmetricKey)
    expect(previous).toMatchObject({
      id: current.id,
      name: current.name,
      fingerprint: current.fingerprint,
      createdAt: current.createdAt,
      status: "rotated",
      rotatedAt: NOW + 1,
    })
    expect(previous.symmetricKey).toBe(current.symmetricKey)
  })

  it("rejects rotating a record that is already rotated", async () => {
    const current = await createSymmetricKeyRecord("rotate once", NOW)
    const { previous } = await rotateSymmetricKeyRecord(current, NOW + 1)

    await expect(
      rotateSymmetricKeyRecord(previous, NOW + 2),
    ).rejects.toMatchObject({
      code: "ENCRYPTION_FAILED",
      message: "ENCRYPTION_FAILED",
    })
  })

  it("rejects a rotation timestamp earlier than the key creation", async () => {
    const current = await createSymmetricKeyRecord("time order", NOW)

    await expect(
      rotateSymmetricKeyRecord(current, NOW - 1),
    ).rejects.toMatchObject({
      code: "ENCRYPTION_FAILED",
      message: "ENCRYPTION_FAILED",
    })
  })

  it("groups one head per lineage with newest predecessors first", async () => {
    const first = await createSymmetricKeyRecord("three generations", NOW)
    const firstRotation = await rotateSymmetricKeyRecord(first, NOW + 1)
    const secondRotation = await rotateSymmetricKeyRecord(
      firstRotation.next,
      NOW + 2,
    )
    const independent = await createSymmetricKeyRecord("independent", NOW + 3)

    const groups = groupSymmetricKeys([
      firstRotation.previous,
      independent,
      secondRotation.next,
      secondRotation.previous,
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(({ head }) => head.id)).toEqual(
      expect.arrayContaining([secondRotation.next.id, independent.id]),
    )
    const lineage = groups.find(({ head }) => head.id === secondRotation.next.id)
    expect(lineage?.head).toBe(secondRotation.next)
    expect(lineage?.previous.map(({ id }) => id)).toEqual([
      secondRotation.previous.id,
      firstRotation.previous.id,
    ])
    expect(groups.find(({ head }) => head.id === independent.id)?.previous).toEqual(
      [],
    )
  })

  it("stops walking when rotatedFromId contains a cycle", async () => {
    const [firstRecord, secondRecord, headRecord] = await Promise.all([
      createSymmetricKeyRecord("cycle", NOW),
      createSymmetricKeyRecord("cycle", NOW + 1),
      createSymmetricKeyRecord("cycle", NOW + 2),
    ])
    const first: StoredKeyRecord = {
      ...firstRecord,
      status: "rotated",
      rotatedFromId: secondRecord.id,
      rotatedAt: NOW + 3,
    }
    const second: StoredKeyRecord = {
      ...secondRecord,
      status: "rotated",
      rotatedFromId: firstRecord.id,
      rotatedAt: NOW + 3,
    }
    const head: StoredKeyRecord = {
      ...headRecord,
      rotatedFromId: first.id,
    }

    const groups = groupSymmetricKeys([first, second, head])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.head).toBe(head)
    expect(groups[0]?.previous.map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ])
  })
})

describe("sym-v2 key records and byte hygiene", () => {
  it("builds and imports an active record with the same fingerprint", async () => {
    const original = await createSymmetricKeyRecord("  original  ", NOW)
    const envelope = await buildSymmetricKeyEnvelopeV2(original)
    const rawKey = envelope.key
    const imported = await importSymmetricKeyRecordV2(
      "  imported  ",
      envelope,
      NOW + 1,
    )

    expect(original.status).toBe("active")
    expect(envelope).toMatchObject({
      version: 2,
      type: "symmetric-key",
      algorithm: "A256GCM",
      keyId: original.id,
      createdAt: original.createdAt,
    })
    expect(imported).toMatchObject({
      id: original.id,
      name: "imported",
      kind: "symmetric",
      algorithm: "A256GCM",
      fingerprint: original.fingerprint,
      createdAt: NOW + 1,
      useCount: 0,
      status: "active",
    })
    expect(imported.symmetricKey?.extractable).toBe(true)
    expect(rawKey).toEqual(new Uint8Array(AES_KEY_BYTES))
  })

  it("refuses to build an envelope from a rotated record", async () => {
    const active = await createSymmetricKeyRecord("rotated", NOW)
    const rotated: StoredKeyRecord = {
      ...active,
      status: "rotated",
      rotatedAt: NOW + 1,
    }

    await expect(buildSymmetricKeyEnvelopeV2(rotated)).rejects.toMatchObject({
      code: "KEY_TYPE_MISMATCH",
      message: "KEY_TYPE_MISMATCH",
    })
  })

  it("zeroizes the raw bytes exported while fingerprinting", async () => {
    const record = await createSymmetricKeyRecord("fingerprint", NOW)
    const raw = Uint8Array.from({ length: AES_KEY_BYTES }, (_, index) => index)
    const expected = await sha256Hex(Uint8Array.from(raw))
    vi.spyOn(crypto.subtle, "exportKey").mockResolvedValue(raw.buffer)

    expect(await fingerprintAesKey(record.symmetricKey!)).toBe(expected)
    expect(raw).toEqual(new Uint8Array(AES_KEY_BYTES))
  })

  it("requires valid symmetric rotation metadata", async () => {
    const active = await createSymmetricKeyRecord("schema", NOW)
    expect(validateStoredKeyRecord(active)).toEqual(active)
    expect(
      validateStoredKeyRecord({
        ...active,
        status: "rotated",
        rotatedAt: NOW + 1,
      }),
    ).toMatchObject({ status: "rotated", rotatedAt: NOW + 1 })

    const { status: omittedStatus, ...withoutStatus } = active
    void omittedStatus
    const invalidRecords: unknown[] = [
      withoutStatus,
      { ...active, rotatedFromId: active.id },
      { ...active, status: "rotated" },
      { ...active, status: "active", rotatedAt: NOW + 1 },
      { ...active, status: "rotated", rotatedAt: NOW - 1 },
    ]

    for (const invalid of invalidRecords) {
      expect(() => validateStoredKeyRecord(invalid)).toThrow()
    }
  })
})
