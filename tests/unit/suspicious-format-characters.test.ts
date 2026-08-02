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
    // Default-ignorable but general category Mn, so a Cf-only scan missed them.
    ["variation selector", "\uFE00"],
    ["combining grapheme joiner", "\u034F"],
    ["variation selector supplement", "\u{E0101}"],
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

  // Deliberate exclusion, not an oversight: U+FE0F appears in ordinary emoji
  // text, and an alert that fires on every such message stops being read. The
  // residual is recorded in docs/security/threat-model.md T21.
  it("does not flag the emoji presentation selector", () => {
    expect(countUnicodeFormatCharacters("❤️")).toBe(0)
    expect(countUnicodeFormatCharacters("️️")).toBe(0)
  })

  it("still flags other variation selectors alongside an emoji one", () => {
    expect(countUnicodeFormatCharacters("❤️︀")).toBe(1)
  })
})
