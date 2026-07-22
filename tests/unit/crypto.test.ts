import { describe, expect, it, vi } from "vitest"
import { decryptWithAesKey, encryptWithAesKey, generateAesKey } from "@/crypto/aes-gcm"
import { buildAad, type AesMessageEnvelopeV1 } from "@/crypto/envelope"
import { fingerprintAesKey, formatFingerprintDisplay } from "@/crypto/fingerprint"
import { importAesKeyRaw } from "@/crypto/key-import-export"
import { toOwnedArrayBuffer, utf8ToBytes } from "@/lib/bytes"
import { MAX_PLAINTEXT_BYTES } from "@/lib/limits"
import { encodeEnvelopeToPayload } from "@/qr/payload"

const KEY_ID = "A".repeat(22)
const NOW = 1_700_000_000_000

function changed(bytes: Uint8Array, index = 0): Uint8Array {
  const copy = Uint8Array.from(bytes)
  copy[index] = copy[index]! ^ 1
  return copy
}

describe("AES-256-GCM", () => {
  it("round-trips Japanese 30 chars, emoji, empty, and the 4096-byte maximum", async () => {
    const key = await generateAesKey()
    expect(key.extractable).toBe(true)
    expect(key.usages).toEqual(["encrypt", "decrypt"])
    const samples = [
      utf8ToBytes("日".repeat(30)),
      utf8ToBytes("暗号🔐 QR📱 emoji"),
      new Uint8Array(),
      new Uint8Array(MAX_PLAINTEXT_BYTES).fill(0x61),
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

  it("rejects non-256-bit raw keys and exposes full plus short fingerprints", async () => {
    for (const length of [0, 16, 31, 33]) {
      await expect(importAesKeyRaw(new Uint8Array(length))).rejects.toMatchObject({
        code: "INVALID_QR_PAYLOAD",
      })
    }
    const key = await importAesKeyRaw(new Uint8Array(32))
    const fingerprint = await fingerprintAesKey(key)
    expect(fingerprint.sha256Hex).toMatch(/^[0-9a-f]{64}$/u)
    expect(fingerprint.display).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/u)
    expect(
      formatFingerprintDisplay(
        new Uint8Array([0x1c, 0xe0, 0x07, 0x30, 0x15, 0x91, 0x23, 0x72]),
      ),
    ).toBe("7392 1840 5521 9074")
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
