// Contract-layer smoke tests.
// Do not invoke stub implementations; verify only implemented portions of the contract.
// These tests may be extended, but must not be removed or weakened.
import { describe, expect, it } from "vitest"
import { AppError, ERROR_CODES, messageFor, toAppError } from "@/crypto/errors"
import {
  FRAME_INTERVAL_MS_VALUES,
  isFrameIntervalMs,
  KEY_ID_PATTERN,
  MAX_CIPHERTEXT_BYTES,
  MAX_PLAINTEXT_BYTES,
} from "@/lib/limits"
import { ecLevelFor, payloadFits, qrByteCapacity } from "@/qr/encode"
import { QR_PREFIX } from "@/qr/payload"
import { toUiAlgorithm, toWireAlgorithm } from "@/schemas/domain"
import { env, parseAppEnv } from "@/schemas/env-schema"
import { hasControlChars, qrNameSchema } from "@/schemas/key-schema"

describe("contract smoke", () => {
  it("keeps only error codes and resolves user messages explicitly by language", () => {
    expect(ERROR_CODES).toHaveLength(20)
    const error = new AppError("DECRYPTION_FAILED")
    expect(error.code).toBe("DECRYPTION_FAILED")
    expect(error).not.toHaveProperty("userMessage")
    expect(messageFor(error.code, "ja")).toBe(
      "復号できませんでした。鍵、暗号方式、または暗号文が一致していません。",
    )
    expect(messageFor("QR_TOO_LARGE", "en")).toContain("QR code")
    expect(toAppError(new Error("x"), "STORAGE_FAILED").code).toBe("STORAGE_FAILED")
    expect(toAppError(error, "STORAGE_FAILED")).toBe(error)
  })

  it("keeps only the active A256GCM v1 mapper", () => {
    expect(toWireAlgorithm("A256GCM")).toBe("A256GCM")
    expect(toUiAlgorithm("A256GCM")).toBe("A256GCM")
    expect(() => toWireAlgorithm("MLKEM1024_A256GCM")).toThrow(TypeError)
  })

  it("env parsing applies defaults and cross-field normalization", () => {
    expect(env.maxPlaintextBytes).toBe(4096)
    expect(MAX_PLAINTEXT_BYTES).toBe(env.maxPlaintextBytes)
    expect(MAX_CIPHERTEXT_BYTES).toBe(MAX_PLAINTEXT_BYTES + 16)
    const normalized = parseAppEnv({ VITE_ENABLE_RSA: "true" })
    expect(normalized.enableRsa).toBe(false)
    expect(normalized.buildSha).toBe("development")
    expect(normalized.qrFrameIntervalMs).toBe(1_000)
    expect(FRAME_INTERVAL_MS_VALUES).toEqual([1_000, 1_500, 2_000, 2_500, 3_000])
    for (const frameIntervalMs of FRAME_INTERVAL_MS_VALUES) {
      expect(isFrameIntervalMs(frameIntervalMs)).toBe(true)
      expect(
        parseAppEnv({
          VITE_QR_FRAME_INTERVAL_MS: String(frameIntervalMs),
        }).qrFrameIntervalMs,
      ).toBe(frameIntervalMs)
    }
    for (const frameIntervalMs of [999, 1_250, 2_250, 3_001]) {
      expect(isFrameIntervalMs(frameIntervalMs)).toBe(false)
      expect(() =>
        parseAppEnv({
          VITE_QR_FRAME_INTERVAL_MS: String(frameIntervalMs),
        }),
      ).toThrow("Invalid environment variables")
    }
    expect(() => parseAppEnv({ VITE_ENABLE_RSA: "yes" })).toThrow(
      "Invalid environment variables",
    )
    expect(() => parseAppEnv({ VITE_QR_RENDER_SIZE: "abc" })).toThrow(
      "Invalid environment variables",
    )
    for (const legacyAlgorithm of ["MLKEM768_A256GCM", "MLKEM768_MLDSA65_A256GCM"]) {
      expect(() => parseAppEnv({ VITE_DEFAULT_ALGORITHM: legacyAlgorithm })).toThrow(
        "Invalid environment variables",
      )
    }
    expect(() => parseAppEnv({ VITE_DEFAULT_PQ_PROFILE: "balanced" })).toThrow(
      "Invalid environment variables",
    )
  })

  it("QR capacity table and EC policy are fixed", () => {
    expect(qrByteCapacity("L")).toBe(2953)
    expect(qrByteCapacity("M")).toBe(2331)
    expect(qrByteCapacity("Q")).toBe(1663)
    expect(qrByteCapacity("H")).toBe(1273)
    expect(payloadFits("a".repeat(1663), "Q")).toBe(true)
    expect(payloadFits("a".repeat(1664), "Q")).toBe(false)
    const prefs = { qrErrorCorrection: "L" as const }
    expect(ecLevelFor("message", prefs)).toBe("L")
    expect(ecLevelFor("stored-key", prefs)).toBe("H")
    expect(ecLevelFor("multipart-frame", prefs)).toBe("Q")
  })

  it("payload prefixes match the protocol doc", () => {
    expect(QR_PREFIX.message).toBe("OCM1:")
    expect(QR_PREFIX["symmetric-key"]).toBe("OCK1:")
    expect(QR_PREFIX["public-key"]).toBe("OCP1:")
    expect(QR_PREFIX["encrypted-private-key"]).toBe("OCB1:")
  })

  it("qr name schema enforces the naming rules", () => {
    expect(qrNameSchema.parse("  暗号文-20260721  ")).toBe("暗号文-20260721")
    expect(() => qrNameSchema.parse("   ")).toThrow()
    expect(() => qrNameSchema.parse("a".repeat(81))).toThrow()
    expect(hasControlChars("ok")).toBe(false)
    expect(hasControlChars(`bad${String.fromCharCode(7)}bell`)).toBe(true)
    expect(() => qrNameSchema.parse(`x${String.fromCharCode(9)}y`)).toThrow()
    expect(KEY_ID_PATTERN.test("A".repeat(22))).toBe(true)
    expect(KEY_ID_PATTERN.test("A".repeat(21))).toBe(false)
  })
})
