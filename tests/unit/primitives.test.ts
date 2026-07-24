import { describe, expect, it } from "vitest"
import { fromBase64Url, toBase64Url } from "@/lib/base64url"
import {
  bytesEqual,
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  sha256Hex,
  toOwnedArrayBuffer,
  utf8ByteLength,
  utf8ToBytes,
} from "@/lib/bytes"
import { detectFeatures } from "@/lib/feature-detect"
import { generateArtifactId, generateKeyId, randomBytes, shortId } from "@/crypto/random"
import { parseAppEnv } from "@/schemas/env-schema"

describe("byte and base64url primitives", () => {
  it("round-trips UTF-8, emoji, bytes, and canonical base64url", async () => {
    const text = "日本語🔐"
    const bytes = utf8ToBytes(text)
    expect(bytesToUtf8(bytes)).toBe(text)
    expect(utf8ByteLength(text)).toBe(bytes.byteLength)
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe("000fff")
    expect(concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    expect(bytesEqual(bytes, Uint8Array.from(bytes))).toBe(true)
    expect(bytesEqual(bytes, new Uint8Array([1]))).toBe(false)
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    expect(await sha256Hex(utf8ToBytes("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })

  it("rejects malformed UTF-8 and non-canonical base64url", () => {
    expect(() => bytesToUtf8(new Uint8Array([0xc3, 0x28]))).toThrow()
    for (const invalid of ["a=", "a+", "A", "AB", "_"]) {
      expect(() => fromBase64Url(invalid)).toThrow()
    }
  })

  it("returns an owned, exact-length ArrayBuffer for sliced input", () => {
    const source = new Uint8Array([9, 1, 2, 8]).subarray(1, 3)
    const owned = toOwnedArrayBuffer(source)
    source[0] = 7
    expect(owned).toBeInstanceOf(ArrayBuffer)
    expect(owned.byteLength).toBe(2)
    expect(new Uint8Array(owned)).toEqual(new Uint8Array([1, 2]))
  })
})

describe("random ids, feature detection, and env parsing", () => {
  it("uses 16-byte random base64url ids", () => {
    expect(randomBytes(12)).toHaveLength(12)
    expect(generateKeyId()).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    const artifactId = generateArtifactId()
    expect(artifactId).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    expect(shortId(artifactId)).toBe(artifactId.slice(0, 8))
    expect(() => randomBytes(0)).toThrow("ENCRYPTION_FAILED")
  })

  it("detects the node test environment without throwing", () => {
    const support = detectFeatures()
    expect(support.webCrypto).toBe(true)
    expect(support.indexedDb).toBe(true)
    expect(typeof support.camera).toBe("boolean")
    expect(typeof support.serviceWorker).toBe("boolean")
  })

  it("strictly parses booleans and integers while ignoring retired RSA enablement", () => {
    const parsed = parseAppEnv({
      VITE_ENABLE_RSA: "true",
      VITE_DEFAULT_ALGORITHM: "MLKEM1024_A256GCM",
      VITE_ENABLE_ECDH: "true",
      VITE_QR_RENDER_SIZE: "640",
      VITE_AUTO_CLEAR_SECONDS: "0",
    })
    expect(parsed.defaultAlgorithm).toBe("MLKEM1024_A256GCM")
    expect(parsed.enableRsa).toBe(false)
    expect(parsed.enableEcdh).toBe(true)
    expect(parsed.qrRenderSize).toBe(640)
    expect(parsed.autoClearSeconds).toBe(0)
    expect(parsed.buildSha).toBe("development")
    for (const raw of [
      { VITE_ENABLE_RSA: "TRUE" },
      { VITE_MAX_PLAINTEXT_BYTES: "0" },
      { VITE_AUTO_CLEAR_SECONDS: "1.5" },
      { VITE_QR_RENDER_SIZE: "Infinity" },
    ]) {
      expect(() => parseAppEnv(raw)).toThrow("Invalid environment variables")
    }
  })
})
