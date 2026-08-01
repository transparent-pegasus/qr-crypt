import { afterEach, describe, expect, it, vi } from "vitest"
import { openSymMessage, sealSymMessage } from "@/crypto/aes-gcm"
import { AppError } from "@/crypto/errors"
import { fingerprintAesKey } from "@/crypto/fingerprint"
import {
  buildSymmetricKeyEnvelopeV2,
  createSymmetricKeyRecord,
  importSymmetricKeyRecordV2,
} from "@/crypto/key-generation"
import { sha256Hex, utf8ToBytes } from "@/lib/bytes"
import {
  AES_GCM_TAG_BYTES,
  AES_KEY_BYTES,
  HKDF_SALT_BYTES,
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
    hkdfSalt: Uint8Array.from(envelope.hkdfSalt),
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

  it("uses a fresh HKDF salt and IV for every seal", async () => {
    const record = await createSymmetricKeyRecord("fresh randomness", NOW)
    const plaintext = utf8ToBytes("same plaintext")
    const first = await sealSymMessage({ record, plaintext, now: NOW + 1 })
    const second = await sealSymMessage({ record, plaintext, now: NOW + 1 })

    expect(first.hkdfSalt).toHaveLength(HKDF_SALT_BYTES)
    expect(second.hkdfSalt).toHaveLength(HKDF_SALT_BYTES)
    expect(second.hkdfSalt).not.toEqual(first.hkdfSalt)
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
      "HKDF salt",
      (envelope: SymMessageEnvelopeV2): SymMessageEnvelopeV2 => ({
        ...cloneEnvelope(envelope),
        hkdfSalt: changed(envelope.hkdfSalt),
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
    ["short HKDF salt", "hkdfSalt", HKDF_SALT_BYTES - 1],
    ["long HKDF salt", "hkdfSalt", HKDF_SALT_BYTES + 1],
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

  it("blocks sealing with a rotated record but still opens its messages", async () => {
    const { record, plaintext, envelope } = await sealedFixture()
    const rotated: StoredKeyRecord = {
      ...record,
      status: "rotated",
      rotatedAt: NOW + 2,
    }

    await expect(
      sealSymMessage({ record: rotated, plaintext, now: NOW + 3 }),
    ).rejects.toMatchObject({
      code: "ENCRYPTION_FAILED",
      message: "ENCRYPTION_FAILED",
    })
    expect(await openSymMessage({ record: rotated, envelope })).toEqual(plaintext)
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
