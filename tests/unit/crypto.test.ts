import { describe, expect, it } from "vitest"
import { generateAesKey } from "@/crypto/aes-gcm"
import { AppError } from "@/crypto/errors"
import { fingerprintAesKey } from "@/crypto/fingerprint"
import { importAesKeyRaw } from "@/crypto/key-import-export"
import { withZeroize } from "@/crypto/pq/zeroize"

describe("AES-256-GCM key primitives", () => {
  it("generates an extractable key for encryption and decryption", async () => {
    const key = await generateAesKey()
    expect(key.extractable).toBe(true)
    expect(key.usages).toEqual(["encrypt", "decrypt"])
  })

  it.each([0, 16, 31, 33])(
    "refuses to import a %i-byte raw key as AES-256",
    async (length) => {
      await expect(importAesKeyRaw(new Uint8Array(length))).rejects.toMatchObject({
        code: "INVALID_QR_PAYLOAD",
      })
    },
  )

  it("fingerprints an AES key as 64 lowercase hex chars", async () => {
    const key = await generateAesKey()
    expect(await fingerprintAesKey(key)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it("does not expose the retired v1 crypto or payload builders", async () => {
    const [aesGcm, keyGeneration, payload] = await Promise.all([
      import("@/crypto/aes-gcm"),
      import("@/crypto/key-generation"),
      import("@/qr/payload"),
    ])

    expect(aesGcm).not.toHaveProperty("encryptWithAesKey")
    expect(aesGcm).not.toHaveProperty("decryptWithAesKey")
    expect(keyGeneration).not.toHaveProperty("importSymmetricKeyRecord")
    expect(keyGeneration).not.toHaveProperty("buildSymmetricKeyEnvelope")
    expect(payload).not.toHaveProperty("QR_PREFIX")
    expect(payload).not.toHaveProperty("encodeEnvelopeToPayload")
  })
})

describe("zeroize", () => {
  it("clears buffers on exceptional finally paths", async () => {
    const secret = new Uint8Array([1, 2, 3, 4])
    await expect(
      withZeroize([secret], async () => {
        throw new AppError("DECRYPTION_FAILED")
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
    expect(secret).toEqual(new Uint8Array(4))
  })
})
