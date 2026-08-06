import { describe, expect, it } from "vitest"
import {
  ERROR_CODES,
  errorMessageKey,
  messageFor,
} from "@/crypto/errors"
import {
  interpolateMessage,
  messages,
  translate,
  type MessageKey,
} from "@/i18n/messages"

describe("i18n catalog", () => {
  it("keeps the English and Japanese key sets identical", () => {
    const englishKeys = Object.keys(messages.en).sort()
    const japaneseKeys = Object.keys(messages.ja).sort()

    expect(japaneseKeys).toEqual(englishKeys)
    expect(new Set(englishKeys).size).toBe(englishKeys.length)
  })

  it("keeps interpolation placeholders identical across locales", () => {
    const placeholders = (message: string) =>
      [...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
        .map((match) => match[1])
        .sort()

    for (const key of Object.keys(messages.en) as MessageKey[]) {
      expect(placeholders(messages.ja[key]), key).toEqual(
        placeholders(messages.en[key]),
      )
    }
  })

  it("keeps retired keys retired in both locales", () => {
    for (const removedKey of [
      "encrypt.decrypt.imageTitle",
      "settings.hooks.preferences.loadFailed",
      "settings.toast.saved",
      "sensitive.secretQrWarning",
      "sensitive.title",
      "common.processing",
      "encrypt.recipient.unverified",
      "encrypt.result.decryptedTitle",
      "encrypt.result.encryptDone",
      "keys.toast.legacyRemoved",
      "scanner.error.singleWhileMultipart",
      "qrDisplay.fullscreen.brightnessHint",
    ]) {
      expect(messages.en).not.toHaveProperty(removedKey)
      expect(messages.ja).not.toHaveProperty(removedKey)
    }
  })

  it("provides an English and Japanese catalog entry for every error code", () => {
    for (const code of ERROR_CODES) {
      const key = errorMessageKey(code)
      expect(Object.hasOwn(messages.en, key), key).toBe(true)
      expect(Object.hasOwn(messages.ja, key), key).toBe(true)
    }
  })

  it("interpolates counts, key IDs, expiry values, and filenames without HTML", () => {
    expect(
      interpolateMessage(
        "count={count}; key={keyId}; expires={expires}; file={filename}",
        {
          count: 3,
          keyId: "key-7",
          expires: "12:30",
          filename: "ciphertext.png",
        },
      ),
    ).toBe("count=3; key=key-7; expires=12:30; file=ciphertext.png")
    expect(
      translate("ja", "settings.field.transferTimeout", { min: 5, max: 120 }),
    ).toBe("読取状態の期限 5〜120 分")
    expect(interpolateMessage("unknown={missing}")).toBe("unknown={missing}")
  })

  it("keeps emphasized acknowledgement segments present and HTML-free", () => {
    const segmentKeys = [
      "offlineAck.body.riskPrefix",
      "offlineAck.body.neverReconnect",
      "offlineAck.body.riskSuffix",
      "offlineAck.body.noGuarantee",
    ] satisfies MessageKey[]
    for (const language of ["en", "ja"] as const) {
      for (const key of segmentKeys) {
        expect(messages[language][key].trim().length, key).toBeGreaterThan(0)
        expect(messages[language][key], key).not.toMatch(/<[^>]+>/)
      }
    }
  })

  it("resolves AppError copy with an explicit language", () => {
    const key = errorMessageKey("STORAGE_FAILED")
    expect(messageFor("STORAGE_FAILED", "en")).toBe(messages.en[key])
    expect(messageFor("STORAGE_FAILED", "ja")).toBe(messages.ja[key])
    expect(messages.en[key]).not.toBe(messages.ja[key])
  })

  it("uses the same language-independent destructive tokens in both locales", () => {
    for (const language of ["en", "ja"] as const) {
      expect(translate(language, "settings.maintenance.dialogDesc")).toContain(
        "KEEP KEYS",
      )
      expect(translate(language, "settings.delete.desc.keys")).toContain(
        "DELETE ALL",
      )
      expect(translate(language, "settings.delete.desc.reset")).toContain(
        "DELETE ALL",
      )
    }
  })
})
