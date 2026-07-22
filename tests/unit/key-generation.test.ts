import { describe, expect, it } from "vitest"
import {
  buildSymmetricKeyEnvelope,
  createSymmetricKeyRecord,
  importSymmetricKeyRecord,
} from "@/crypto/key-generation"

const NOW = 1_700_000_000_000

describe("high-level key generation and exchange", () => {
  it("round-trips a symmetric-key envelope with the same id and fingerprint", async () => {
    const original = await createSymmetricKeyRecord(" 共有鍵 ", NOW)
    expect(original.name).toBe("共有鍵")
    expect(original.kind).toBe("symmetric")
    const envelope = await buildSymmetricKeyEnvelope(original)
    expect(envelope.key).toHaveLength(32)
    const imported = await importSymmetricKeyRecord("受信鍵", envelope, NOW + 1)
    expect(imported.id).toBe(original.id)
    expect(imported.fingerprint).toBe(original.fingerprint)
    expect(imported.symmetricKey?.extractable).toBe(true)
  })

  it("normalizes invalid key-kind operations to AppError", async () => {
    const symmetric = await createSymmetricKeyRecord("共有鍵", NOW)
    await expect(
      buildSymmetricKeyEnvelope({ ...symmetric, kind: "public-key" }),
    ).rejects.toMatchObject({
      code: "KEY_TYPE_MISMATCH",
    })
  })
})
