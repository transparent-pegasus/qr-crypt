import { describe, expect, it } from "vitest"
import {
  formatDateTime,
  formatFingerprint,
  isQrCryptPayload,
} from "@/features/presentation"
import { QR_PREFIX_V2 } from "@/qr/payload-v2"

describe("presentation formatting", () => {
  it("returns the em-dash fallback for a non-finite timestamp", () => {
    expect(formatDateTime(Number.NaN, "en")).toBe("—")
  })

  it("renders four check-digit groups from the first 16 hex chars (big-endian uint16 mod 10000)", () => {
    const hex = "000102030405060708090a0b0c0d0e0f".repeat(2)
    expect(formatFingerprint(hex)).toBe("0001 0515 1029 1543")
  })

  it("returns short input unchanged instead of fabricating groups", () => {
    expect(formatFingerprint("abc")).toBe("abc")
  })

  it("recognizes only active v2 prefixes", () => {
    const { "encrypted-seed-backup": reserved, ...active } = QR_PREFIX_V2
    for (const prefix of Object.values(active)) {
      expect(isQrCryptPayload(`${prefix}payload`)).toBe(true)
    }
    expect(isQrCryptPayload(`${reserved}payload`)).toBe(false)
    expect(isQrCryptPayload("OCX9:payload")).toBe(false)
    expect(isQrCryptPayload("plain text")).toBe(false)
  })
})
