import { describe, expect, it, vi } from "vitest"
import { decryptWithAesKey, encryptWithAesKey, generateAesKey } from "@/crypto/aes-gcm"
import { buildAad, type AesMessageEnvelopeV1 } from "@/crypto/envelope"
import { AppError } from "@/crypto/errors"
import { fingerprintAesKey } from "@/crypto/fingerprint"
import { importAesKeyRaw } from "@/crypto/key-import-export"
import { withZeroize } from "@/crypto/pq/zeroize"
import { toOwnedArrayBuffer, utf8ToBytes } from "@/lib/bytes"
import {
  MAX_PLAINTEXT_BYTES,
  MAX_SYMMETRIC_PLAINTEXT_BYTES,
} from "@/lib/limits"
import { encodeEnvelopeToPayload } from "@/qr/payload"

const KEY_ID = "A".repeat(22)
const NOW = 1_700_000_000_000

function changed(bytes: Uint8Array, index = 0): Uint8Array {
  const copy = Uint8Array.from(bytes)
  copy[index] = copy[index]! ^ 1
  return copy
}

describe("AES-256-GCM", () => {
  it("round-trips Japanese 30 chars, emoji, empty, and the symmetric maximum", async () => {
    const key = await generateAesKey()
    expect(key.extractable).toBe(true)
    expect(key.usages).toEqual(["encrypt", "decrypt"])
    const samples = [
      utf8ToBytes("日".repeat(30)),
      utf8ToBytes("暗号🔐 QR📱 emoji"),
      new Uint8Array(),
      new Uint8Array(MAX_SYMMETRIC_PLAINTEXT_BYTES).fill(0x61),
    ]
    for (const plaintext of samples) {
      const envelope = await encryptWithAesKey({
        key,
        keyId: KEY_ID,
        plaintext,
        now: NOW,
      })
      expect(await decryptWithAesKey({ key, envelope })).toEqual(plaintext)
    }
  })

  it("rejects wrong keys, bit flips, both AAD tamper forms, and invalid IV sizes", async () => {
    const key = await generateAesKey()
    const wrongKey = await generateAesKey()
    const envelope = await encryptWithAesKey({
      key,
      keyId: KEY_ID,
      plaintext: utf8ToBytes("認証対象"),
      now: NOW,
    })
    await expect(decryptWithAesKey({ key: wrongKey, envelope })).rejects.toMatchObject({
      code: "DECRYPTION_FAILED",
    })
    await expect(
      decryptWithAesKey({
        key,
        envelope: { ...envelope, ciphertext: changed(envelope.ciphertext) },
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
    await expect(
      decryptWithAesKey({
        key,
        envelope: { ...envelope, aad: changed(envelope.aad) },
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
    const changedCreatedAt = envelope.createdAt + 1
    const recomputedAad = buildAad({
      v: 1,
      type: "message",
      algorithm: "A256GCM",
      keyId: envelope.keyId,
      createdAt: changedCreatedAt,
    })
    await expect(
      decryptWithAesKey({
        key,
        envelope: { ...envelope, createdAt: changedCreatedAt, aad: recomputedAad },
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
    for (const length of [11, 13]) {
      await expect(
        decryptWithAesKey({
          key,
          envelope: { ...envelope, iv: new Uint8Array(length) },
        }),
      ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
    }
  })

  it("uses a different 96-bit IV on repeated encryption and rejects oversize input", async () => {
    const key = await generateAesKey()
    const first = await encryptWithAesKey({
      key,
      keyId: KEY_ID,
      plaintext: new Uint8Array(),
      now: NOW,
    })
    const second = await encryptWithAesKey({
      key,
      keyId: KEY_ID,
      plaintext: new Uint8Array(),
      now: NOW + 1,
    })
    expect(first.iv).toHaveLength(12)
    expect(second.iv).toHaveLength(12)
    expect(second.iv).not.toEqual(first.iv)
    await expect(
      encryptWithAesKey({
        key,
        keyId: KEY_ID,
        plaintext: new Uint8Array(MAX_PLAINTEXT_BYTES + 1),
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "ENCRYPTION_FAILED" })
  })

  it("does not invoke subtle.decrypt when the stored AAD differs", async () => {
    const key = await generateAesKey()
    const envelope = await encryptWithAesKey({
      key,
      keyId: KEY_ID,
      plaintext: utf8ToBytes("early-reject"),
      now: NOW,
    })
    const decryptSpy = vi.spyOn(crypto.subtle, "decrypt")
    await expect(
      decryptWithAesKey({
        key,
        envelope: { ...envelope, aad: changed(envelope.aad) },
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
    expect(decryptSpy).not.toHaveBeenCalled()
    decryptSpy.mockRestore()
  })

  it("fingerprints an AES key as 64 lowercase hex chars", async () => {
    const key = await generateAesKey()
    expect(await fingerprintAesKey(key)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it("matches the fixed CBOR golden payload and decrypts it", async () => {
    const raw = Uint8Array.from({ length: 32 }, (_, index) => index)
    const iv = Uint8Array.from({ length: 12 }, (_, index) => 0xa0 + index)
    const plaintext = utf8ToBytes("固定ベクトル🔐")
    const key = await importAesKeyRaw(raw)
    const aad = buildAad({
      v: 1,
      type: "message",
      algorithm: "A256GCM",
      keyId: KEY_ID,
      createdAt: NOW,
    })
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(iv),
          additionalData: toOwnedArrayBuffer(aad),
          tagLength: 128,
        },
        key,
        toOwnedArrayBuffer(plaintext),
      ),
    )
    const envelope: AesMessageEnvelopeV1 = {
      v: 1,
      type: "message",
      algorithm: "A256GCM",
      keyId: KEY_ID,
      createdAt: NOW,
      iv,
      ciphertext,
      aad,
    }
    expect(encodeEnvelopeToPayload(envelope)).toBe(
      "OCM1:uQAIYXYBZHR5cGVnbWVzc2FnZWlhbGdvcml0aG1nQTI1NkdDTWVrZXlJZHZBQUFBQUFBQUFBQUFBQUFBQUFBQUFBaWNyZWF0ZWRBdPtCeLz-VoAAAGJpdkygoaKjpKWmp6ipqqtqY2lwaGVydGV4dFgmA4PGyOtR4Tz7hgV85PlIPfMHqY8GJ0BKNZpnr7nb1xEqf3mh2XFjYWFkWD1PQ0FBRDF8MXxtZXNzYWdlfEEyNTZHQ018QUFBQUFBQUFBQUFBQUFBQUFBQUFBQXwxNzAwMDAwMDAwMDAw",
    )
    expect(await decryptWithAesKey({ key, envelope })).toEqual(plaintext)
  })
})

it("withZeroize clears buffers on exceptional finally paths", async () => {
  const secret = new Uint8Array([1, 2, 3, 4])
  await expect(
    withZeroize([secret], async () => {
      throw new AppError("DECRYPTION_FAILED")
    }),
  ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  expect(secret).toEqual(new Uint8Array(4))
})
