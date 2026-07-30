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

  it("pins the reviewed failure and safety copy, and keeps retired keys retired", () => {
    expect(messages.en).toMatchObject({
      "errors.WORKER_UNAVAILABLE":
        "Cryptographic processing could not be performed safely on this device. Reopen the app in a supported browser.",
      "animatedQr.missing.body":
        "Missing frames: {indexes}. Recovery is not possible while frames are missing.",
      "scanner.progress.missingIndex": "Missing frames: {indexes}",
      "errors.QR_DECODE_PROGRESS_TIMEOUT":
        "The QR decoding pipeline stopped making progress on this device.",
      "settings.error.saveFailed":
        "Settings could not be saved. Check the device storage.",
      "settings.error.deleteFailed":
        "Data could not be deleted. Check the device storage.",
      "hooks.preferences.loadFailed":
        "Settings could not be loaded. Default values will be used.",
    })
    expect(messages.ja).toMatchObject({
      "animatedQr.missing.body":
        "欠損フレーム: {indexes}。欠損したままでは復元できません。",
      "encrypt.toast.autoCleared": "平文と一時結果を自動消去しました",
      "scanner.error.singleWhileMultipart":
        "複数QR読取中です。単発QRは読取完了または破棄後に読み取ってください。",
      "scanner.progress.missingIndex": "欠損フレーム: {indexes}",
      "errors.QR_DECODE_PROGRESS_TIMEOUT":
        "この端末でQR復号パイプラインの進行が停止しました。",
      "hooks.preferences.loadFailed":
        "設定を読み込めませんでした。既定値を使用します。",
    })
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

  it("keeps emphasized acknowledgement copy as safe text segments", () => {
    const segmentKeys = [
      "offlineAck.body.riskPrefix",
      "offlineAck.body.neverReconnect",
      "offlineAck.body.riskSuffix",
      "offlineAck.body.noGuarantee",
    ] satisfies MessageKey[]
    const japaneseText = segmentKeys.map((key) => messages.ja[key]).join("")

    expect(japaneseText).toBe(
      "リスクを抑えるには、ネットワークから物理的に遮断し、二度と接続しない専用端末として運用する必要があります。それ以外に、完全に安全にメッセージの暗号化を行う方法はありません。それでも、端末や導入済みコードを含めた完全な安全を本アプリが保証するものではありません。",
    )
    for (const language of ["en", "ja"] as const) {
      for (const key of segmentKeys) {
        expect(messages[language][key]).not.toMatch(/<[^>]+>/)
      }
    }
  })

  it("resolves AppError copy with an explicit language", () => {
    expect(messageFor("STORAGE_FAILED", "en")).toBe("The storage operation failed.")
    expect(messageFor("STORAGE_FAILED", "ja")).toBe("保存領域の操作に失敗しました。")
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
