import { describe, expect, it } from "vitest"
import { formatDateTime, formatFingerprint } from "@/features/presentation"

describe("presentation formatting", () => {
  it("returns the em-dash fallback for a non-finite timestamp", () => {
    expect(formatDateTime(Number.NaN, "en")).toBe("—")
  })

  it("renders the entire digest as lowercase hexadecimal groups", () => {
    expect(
      formatFingerprint(
        "000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F",
      ),
    ).toBe(
      "0001 0203 0405 0607 0809 0a0b 0c0d 0e0f 1011 1213 1415 1617 1819 1a1b 1c1d 1e1f",
    )
  })

  it("does not alias first words 0000 and 2710 modulo 10000", () => {
    expect(formatFingerprint("0000" + "0".repeat(60))).not.toBe(
      formatFingerprint("2710" + "0".repeat(60)),
    )
  })

  it("preserves differences after the first sixteen positions", () => {
    expect(formatFingerprint("0123456789abcdef" + "0".repeat(48))).not.toBe(
      formatFingerprint("0123456789abcdef" + "f".repeat(48)),
    )
  })

  it.each(Array.from({ length: 64 }, (_, index) => index))(
    "keeps digest position %i in the visible comparison",
    (index) => {
      const changed = "0".repeat(index) + "1" + "0".repeat(63 - index)
      expect(formatFingerprint(changed).replaceAll(" ", "")).toBe(changed)
    },
  )

  it("groups an already separated digest without losing digits", () => {
    expect(
      formatFingerprint(
        "0001 0203 0405 0607 0809 0A0B 0C0D 0E0F 1011 1213 1415 1617 1819 1A1B 1C1D 1E1F",
      ),
    ).toBe(
      "0001 0203 0405 0607 0809 0a0b 0c0d 0e0f 1011 1213 1415 1617 1819 1a1b 1c1d 1e1f",
    )
  })

  it("returns short input unchanged instead of fabricating groups", () => {
    expect(formatFingerprint("abc")).toBe("abc")
  })
})
