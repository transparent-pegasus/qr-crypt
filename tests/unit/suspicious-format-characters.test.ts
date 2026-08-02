import { describe, expect, it } from "vitest"
import { countUnicodeFormatCharacters } from "@/lib/bytes"

describe("suspicious format characters", () => {
  it.each([
    ["general-category Cf", "\u2060"],
    ["zero-width character", "\u200B"],
    ["zero-width no-break space", "\uFEFF"],
    ["bidi override", "\u202E"],
    ["bidi isolate", "\u2066"],
    ["soft hyphen", "\u00AD"],
  ] as const)("flags a %s", (_name, character) => {
    expect(countUnicodeFormatCharacters(`left${character}right`)).toBe(1)
  })

  it("counts every suspicious code point", () => {
    expect(
      countUnicodeFormatCharacters(
        "one\u200Btwo\u202Ethree\u2066four\u00ADfive\uFEFF",
      ),
    ).toBe(5)
  })

  it.each([
    ["English", "Ordinary English plaintext"],
    ["Japanese", "通常の日本語の平文"],
    ["CJK", "漢字"],
    ["emoji", "🔐🙂"],
    ["combining marks", "Cafe\u0301"],
    ["newlines", "first line\nsecond line"],
  ] as const)("does not flag ordinary %s text", (_name, plaintext) => {
    expect(countUnicodeFormatCharacters(plaintext)).toBe(0)
  })

  it("reports no suspicious characters in an empty string", () => {
    expect(countUnicodeFormatCharacters("")).toBe(0)
  })
})
