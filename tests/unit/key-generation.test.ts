import { describe, expect, it } from "vitest"
import {
  buildSymmetricKeyEnvelopeV2,
  createSymmetricKeyRecord,
  importSymmetricKeyRecordV2,
  rotateSymmetricKeyRecord,
} from "@/crypto/key-generation"

const NOW = 1_700_000_000_000

describe("high-level key generation and exchange", () => {
  it("round-trips a symmetric-key envelope with the same id and fingerprint", async () => {
    const original = await createSymmetricKeyRecord(" 共有鍵 ", NOW)
    expect(original.name).toBe("共有鍵")
    expect(original.kind).toBe("symmetric")
    const envelope = await buildSymmetricKeyEnvelopeV2(original)
    expect(envelope.key).toHaveLength(32)
    const imported = await importSymmetricKeyRecordV2("受信鍵", envelope, NOW + 1)
    expect(imported.id).toBe(original.id)
    expect(imported.fingerprint).toBe(original.fingerprint)
    expect(imported.symmetricKey?.extractable).toBe(true)
  })

  it("normalizes export of a rotated key to AppError", async () => {
    const symmetric = await createSymmetricKeyRecord("共有鍵", NOW)
    const { previous } = await rotateSymmetricKeyRecord(symmetric, NOW + 1)
    await expect(
      buildSymmetricKeyEnvelopeV2(previous),
    ).rejects.toMatchObject({
      code: "KEY_TYPE_MISMATCH",
    })
  })
})
