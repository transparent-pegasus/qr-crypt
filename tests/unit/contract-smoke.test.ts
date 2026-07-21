// 契約レイヤーの smoke テスト(plan §13 C2/C4)。
// スタブ実装の呼出はせず、実装済みの契約部分のみを検証する。
// WP-2 はこのテストを緑に保ったまま拡張してよい(削除・弱体化は不可)。
import { describe, expect, it } from "vitest"
import { AppError, ERROR_CODES, toAppError, userMessageFor } from "@/crypto/errors"
import { KEY_ID_PATTERN, MAX_CIPHERTEXT_BYTES, MAX_PLAINTEXT_BYTES } from "@/lib/limits"
import { ecLevelFor, payloadFits, qrByteCapacity } from "@/qr/encode"
import { QR_PREFIX } from "@/qr/payload"
import {
  sensitivityForKind,
  toUiAlgorithm,
  toWireAlgorithm,
} from "@/schemas/domain"
import { env, parseAppEnv } from "@/schemas/env-schema"
import { hasControlChars, qrNameSchema } from "@/schemas/key-schema"

describe("contract smoke", () => {
  it("error model exposes all 15 spec codes with Japanese user messages", () => {
    expect(ERROR_CODES).toHaveLength(15)
    const error = new AppError("DECRYPTION_FAILED")
    expect(error.code).toBe("DECRYPTION_FAILED")
    expect(error.userMessage).toBe(
      "復号できませんでした。鍵、暗号方式、または暗号文が一致していません。",
    )
    expect(userMessageFor("QR_TOO_LARGE")).toContain("QRコード")
    expect(toAppError(new Error("x"), "STORAGE_FAILED").code).toBe(
      "STORAGE_FAILED",
    )
    expect(toAppError(error, "STORAGE_FAILED")).toBe(error)
  })

  it("algorithm ids round-trip between UI and wire layers", () => {
    expect(toWireAlgorithm("A256GCM")).toBe("A256GCM")
    expect(toWireAlgorithm("RSA-HYBRID")).toBe("RSA-OAEP-3072+A256GCM")
    expect(toUiAlgorithm("A256GCM")).toBe("A256GCM")
    expect(toUiAlgorithm("RSA-OAEP-3072+A256GCM")).toBe("RSA-HYBRID")
  })

  it("sensitivity mapping follows spec §14", () => {
    expect(sensitivityForKind("public-key")).toBe("public")
    expect(sensitivityForKind("ciphertext")).toBe("confidential")
    expect(sensitivityForKind("symmetric-key")).toBe("secret")
    expect(sensitivityForKind("encrypted-private-key")).toBe("secret")
  })

  it("env parsing applies defaults and cross-field normalization", () => {
    expect(env.maxPlaintextBytes).toBe(4096)
    expect(MAX_PLAINTEXT_BYTES).toBe(env.maxPlaintextBytes)
    expect(MAX_CIPHERTEXT_BYTES).toBe(MAX_PLAINTEXT_BYTES + 16)
    const normalized = parseAppEnv({
      VITE_ENABLE_RSA: "false",
      VITE_DEFAULT_ALGORITHM: "RSA-HYBRID",
    })
    expect(normalized.defaultAlgorithm).toBe("A256GCM")
    expect(normalized.buildSha).toBe("development")
    expect(() => parseAppEnv({ VITE_ENABLE_RSA: "yes" })).toThrow(
      "環境変数が不正です",
    )
    expect(() => parseAppEnv({ VITE_QR_RENDER_SIZE: "abc" })).toThrow(
      "環境変数が不正です",
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
    expect(ecLevelFor("ciphertext", prefs)).toBe("L")
    expect(ecLevelFor("symmetric-key", prefs)).toBe("H")
    expect(ecLevelFor("public-key", prefs)).toBe("H")
    expect(ecLevelFor("encrypted-private-key", prefs)).toBe("H")
  })

  it("payload prefixes match the protocol doc", () => {
    expect(QR_PREFIX.message).toBe("OCM1:")
    expect(QR_PREFIX["symmetric-key"]).toBe("OCK1:")
    expect(QR_PREFIX["public-key"]).toBe("OCP1:")
    expect(QR_PREFIX["encrypted-private-key"]).toBe("OCB1:")
  })

  it("qr name schema enforces spec §14 rules", () => {
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
