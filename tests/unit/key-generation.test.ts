import { describe, expect, it } from "vitest"
import {
  buildPublicKeyEnvelope,
  buildSymmetricKeyEnvelope,
  createRsaKeyPairRecord,
  createSymmetricKeyRecord,
  importPublicKeyRecord,
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

  it("round-trips a public-key envelope without exporting the private key", async () => {
    const pair = await createRsaKeyPairRecord("端末B", NOW)
    expect(pair.privateKey?.extractable).toBe(false)
    const envelope = await buildPublicKeyEnvelope(pair)
    expect(envelope.spki.byteLength).toBeGreaterThanOrEqual(350)
    const imported = await importPublicKeyRecord("端末B公開鍵", envelope, NOW + 1)
    expect(imported.id).toBe(pair.id)
    expect(imported.kind).toBe("public-key")
    expect(imported.fingerprint).toBe(pair.fingerprint)
    expect(imported.privateKey).toBeUndefined()
    expect(imported.publicKey?.usages).toEqual(["encrypt", "wrapKey"])
  })

  it("normalizes invalid key-kind operations to AppError", async () => {
    const symmetric = await createSymmetricKeyRecord("共有鍵", NOW)
    const pair = await createRsaKeyPairRecord("鍵ペア", NOW)
    await expect(buildPublicKeyEnvelope(symmetric)).rejects.toMatchObject({
      code: "KEY_TYPE_MISMATCH",
    })
    await expect(buildSymmetricKeyEnvelope(pair)).rejects.toMatchObject({
      code: "KEY_TYPE_MISMATCH",
    })
  })
})
