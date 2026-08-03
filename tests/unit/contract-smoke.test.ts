// Contract-layer smoke tests.
// Do not invoke stub implementations; verify only implemented portions of the contract.
// These tests may be extended, but must not be removed or weakened.
import { describe, expect, it } from "vitest"
import { AppError, ERROR_CODES, toAppError } from "@/crypto/errors"
import {
  FRAME_INTERVAL_MS_VALUES,
  KEY_ID_PATTERN,
  MAX_PLAINTEXT_BYTES,
  MAX_PQ_PLAINTEXT_BYTES,
  MAX_SYM_PLAINTEXT_BYTES,
} from "@/lib/limits"
import { QR_PREFIX_V2 } from "@/qr/payload-v2"
import { env, parseAppEnv } from "@/schemas/env-schema"
import { hasControlChars, qrNameSchema } from "@/schemas/key-schema"

describe("contract smoke", () => {
  it("keeps errors code-only and preserves AppError instances", () => {
    expect(ERROR_CODES).toContain("KEY_ID_CONFLICT")
    expect(ERROR_CODES).toContain("MESSAGE_ID_REUSED")
    const error = new AppError("DECRYPTION_FAILED")
    expect(error.code).toBe("DECRYPTION_FAILED")
    expect(error).not.toHaveProperty("userMessage")
    expect(toAppError(new Error("x"), "STORAGE_FAILED").code).toBe("STORAGE_FAILED")
    expect(toAppError(error, "STORAGE_FAILED")).toBe(error)
  })

  it("env parsing applies defaults, cross-field normalization, and retired-value rejection", () => {
    expect(env.maxPlaintextBytes).toBe(120_000)
    expect(MAX_PQ_PLAINTEXT_BYTES).toBe(env.maxPlaintextBytes)
    // The shared allocation ceiling must not drift off the PQ ceiling; typecheck
    // does not catch a later edit that reassigns it.
    expect(MAX_PLAINTEXT_BYTES).toBe(MAX_PQ_PLAINTEXT_BYTES)
    // Sym-v2 is deliberately capped to one frame, independently of the PQ
    // multipart allocation ceiling.
    expect(MAX_SYM_PLAINTEXT_BYTES).toBe(853)
    expect(MAX_SYM_PLAINTEXT_BYTES).toBeLessThan(MAX_PQ_PLAINTEXT_BYTES)
    const normalized = parseAppEnv({})
    expect(normalized.qrFrameBytes).toBe(1_000)
    expect(normalized.qrFrameIntervalMs).toBe(200)
    for (const frameIntervalMs of FRAME_INTERVAL_MS_VALUES) {
      expect(
        parseAppEnv({
          VITE_QR_FRAME_INTERVAL_MS: String(frameIntervalMs),
        }).qrFrameIntervalMs,
      ).toBe(frameIntervalMs)
    }
    for (const frameIntervalMs of [199, 250, 1_001, 1_500, 3_000]) {
      expect(() =>
        parseAppEnv({
          VITE_QR_FRAME_INTERVAL_MS: String(frameIntervalMs),
        }),
      ).toThrow("Invalid environment variables")
    }
    expect(() => parseAppEnv({ VITE_QR_RENDER_SIZE: "abc" })).toThrow(
      "Invalid environment variables",
    )
    for (const removedAlgorithm of [
      "MLKEM768_A256GCM",
      "MLKEM768_MLDSA65_A256GCM",
      "MLKEM1024_A256GCM",
    ]) {
      expect(() => parseAppEnv({ VITE_DEFAULT_ALGORITHM: removedAlgorithm })).toThrow(
        "Invalid environment variables",
      )
    }
  })

  it("omits retired post-quantum preferences from the parsed environment", () => {
    const parsed = parseAppEnv({})
    expect(parsed).not.toHaveProperty("defaultPqProfile")
    expect(parsed).not.toHaveProperty("requireSignature")
  })

  it.each([
    ["VITE_DEFAULT_PQ_PROFILE", "maximum"],
    ["VITE_REQUIRE_SIGNATURE", "false"],
  ] as const)("rejects retired environment identifier %s", (identifier, value) => {
    expect(() => parseAppEnv({ [identifier]: value })).toThrow(
      `Invalid environment variables: ${identifier}`,
    )
  })

  it.each(["false", "yes"] as const)(
    "rejects retired VITE_ENABLE_RSA=%s",
    (value) => {
      expect(() => parseAppEnv({ VITE_ENABLE_RSA: value })).toThrow(
        /^Invalid environment variables: VITE_ENABLE_RSA$/u,
      )
    },
  )

  it("payload prefixes expose only the v2 wire family", () => {
    expect(QR_PREFIX_V2["sym-message"]).toBe("OCA2:")
    expect(QR_PREFIX_V2["symmetric-key"]).toBe("OCK2:")
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
