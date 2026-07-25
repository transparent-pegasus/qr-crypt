import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  LANGUAGE_STORAGE_KEY,
  LanguageProvider,
  LanguageSelect,
  readStoredLanguage,
  useI18n,
  useLocalizedMessage,
} from "@/i18n"
import { bestEffortLocalReset } from "@/storage/best-effort-reset"
import { OC_LOCAL_STORAGE_CLEARED_EVENT } from "@/storage/reset-events"
import { memoryLocalStorage } from "./helpers/render-app"

function LanguageProbe() {
  const { t } = useI18n()
  return <p>{t("browser.unsupported.title")}</p>
}

function ErrorProbe() {
  const message = useLocalizedMessage("STORAGE_FAILED")
  return <p>{message}</p>
}

describe("LanguageProvider", () => {
  beforeEach(() => {
    memoryLocalStorage.clear()
    document.documentElement.lang = "ja"
  })
  afterEach(cleanup)

  it("defaults to English without consulting navigator", () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    )

    expect(screen.getByText("This browser is not supported")).toBeInTheDocument()
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en")
    expect(document.documentElement.lang).toBe("en")
  })

  it("switches visible copy, persistence, and the document language", async () => {
    const user = userEvent.setup()
    render(
      <LanguageProvider>
        <LanguageSelect />
        <LanguageProbe />
        <ErrorProbe />
      </LanguageProvider>,
    )

    expect(screen.getByText("The storage operation failed.")).toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: "Language" }))
    await user.click(screen.getByRole("option", { name: "日本語" }))
    expect(screen.getByText("このブラウザーでは利用できません")).toBeInTheDocument()
    expect(screen.getByText("保存領域の操作に失敗しました。")).toBeInTheDocument()
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ja")
    expect(document.documentElement.lang).toBe("ja")

    await user.click(screen.getByRole("combobox", { name: "言語" }))
    await user.click(screen.getByRole("option", { name: "English" }))
    expect(screen.getByText("This browser is not supported")).toBeInTheDocument()
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en")
    expect(document.documentElement.lang).toBe("en")
  })

  it("returns to English after the best-effort reset removes every oc-* key", async () => {
    memoryLocalStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
    memoryLocalStorage.setItem("oc-theme", "dark")
    memoryLocalStorage.setItem("oc-offline-ack-pending", "1")
    memoryLocalStorage.setItem("unrelated", "preserved")

    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    )
    expect(screen.getByText("このブラウザーでは利用できません")).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("ja")

    let ocKeysWhenCleared: (string | null)[] | undefined
    window.addEventListener(
      OC_LOCAL_STORAGE_CLEARED_EVENT,
      () => {
        ocKeysWhenCleared = Array.from(
          { length: memoryLocalStorage.length },
          (_, index) => memoryLocalStorage.key(index),
        ).filter((key) => key?.startsWith("oc-"))
      },
      { once: true },
    )

    let report
    await act(async () => {
      report = await bestEffortLocalReset(
        { reason: "user-requested", resetChurnMb: 0 },
        {
          deleteDatabase: async () => undefined,
          deleteVaultEncryptedSecrets: async () => undefined,
          deleteVaultKey: async () => undefined,
          verifyDatabaseAbsent: async () => false,
        },
      )
    })
    expect(report).toEqual({ ok: true, failedSteps: [] })
    expect(ocKeysWhenCleared).toEqual([])
    expect(memoryLocalStorage.getItem("unrelated")).toBe("preserved")
    expect(readStoredLanguage()).toBe("en")
    expect(screen.getByText("This browser is not supported")).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("en")
  })

  it("returns a mounted peer tab to English when its language key is removed", () => {
    memoryLocalStorage.setItem(LANGUAGE_STORAGE_KEY, "ja")
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    )

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: LANGUAGE_STORAGE_KEY,
          oldValue: "ja",
          newValue: null,
        }),
      )
    })

    expect(screen.getByText("This browser is not supported")).toBeInTheDocument()
    expect(document.documentElement.lang).toBe("en")
  })
})
