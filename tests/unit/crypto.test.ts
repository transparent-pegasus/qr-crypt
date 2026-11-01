import { describe, expect, it } from "vitest"
import { generateAesKey } from "@/crypto/aes-gcm"
import { fingerprintAesKey } from "@/crypto/fingerprint"
import { importAesKeyRaw } from "@/crypto/key-import-export"

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
})
