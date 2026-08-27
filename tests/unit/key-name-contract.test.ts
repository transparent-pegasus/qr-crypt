import { describe, expect, it } from "vitest"
import { KEY_ID_PATTERN } from "@/lib/limits"
import { hasControlChars, qrNameSchema } from "@/schemas/key-schema"

describe("key name contract", () => {
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
