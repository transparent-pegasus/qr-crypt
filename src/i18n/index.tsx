import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { cn } from "@/lib/utils"
import {
  isMessageKey,
  translate,
  type InterpolationValues,
  type Language,
  type MessageKey,
} from "@/i18n/messages"
import {
  errorMessageKey,
  isErrorCode,
  type ErrorCode,
} from "@/crypto/errors"
import { OC_LOCAL_STORAGE_CLEARED_EVENT } from "@/storage/reset-events"

export const LANGUAGE_STORAGE_KEY = "oc-lang"
export const DELETE_ALL_CONFIRMATION = "DELETE ALL"
export const KEEP_KEYS_CONFIRMATION = "KEEP KEYS"

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "ja"
}

export function readStoredLanguage(): Language {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(value) ? value : "en"
  } catch {
    return "en"
  }
}

export function syncDocumentLanguage(language: Language): void {
  document.documentElement.lang = language
}

export type Translate = (key: MessageKey, values?: InterpolationValues) => string
export type LocalizedMessage = ErrorCode | MessageKey

interface LanguageContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: Translate
}

const DEFAULT_LANGUAGE_CONTEXT: LanguageContextValue = {
  language: "en",
  setLanguage: () => undefined,
  t: (key, values) => translate("en", key, values),
}

const LanguageContext = createContext<LanguageContextValue>(DEFAULT_LANGUAGE_CONTEXT)

export function LanguageProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode
  initialLanguage?: Language
}) {
  const [language, setLanguageState] = useState<Language>(
    () => initialLanguage ?? readStoredLanguage(),
  )

  const setLanguage = useCallback((nextLanguage: Language) => {
    syncDocumentLanguage(nextLanguage)
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
    } catch {
      // Language persistence is best-effort; the in-memory selection still applies.
    }
    setLanguageState(nextLanguage)
  }, [])

  useEffect(() => {
    const resetToEnglish = () => {
      syncDocumentLanguage("en")
      setLanguageState("en")
    }
    const handlePeerStorageReset = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY && event.newValue === null) {
        resetToEnglish()
      }
    }

    window.addEventListener(OC_LOCAL_STORAGE_CLEARED_EVENT, resetToEnglish)
    window.addEventListener("storage", handlePeerStorageReset)
    return () => {
      window.removeEventListener(OC_LOCAL_STORAGE_CLEARED_EVENT, resetToEnglish)
      window.removeEventListener("storage", handlePeerStorageReset)
    }
  }, [])

  useLayoutEffect(() => {
    syncDocumentLanguage(language)
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    } catch {
      // Keep the in-memory language when persistence is unavailable.
    }
  }, [language])

  const t = useCallback<Translate>(
    (key, values) => translate(language, key, values),
    [language],
  )
  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n(): LanguageContextValue {
  return useContext(LanguageContext)
}

export function messageKeyOrFallback(
  message: unknown,
  fallback: MessageKey,
): MessageKey {
  return isMessageKey(message) ? message : fallback
}

export function useLocalizedMessage(
  message: LocalizedMessage | null | undefined,
): string | null {
  const { t } = useI18n()
  if (message === null || message === undefined) return null
  if (isErrorCode(message)) return t(errorMessageKey(message))
  return t(message)
}

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage, t } = useI18n()

  return (
    <div
      role="group"
      aria-label={t("language.toggle.ariaLabel")}
      className={cn(
        "inline-flex min-h-11 items-center rounded-lg border bg-background p-1 text-sm shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={language === "en"}
        className={cn(
          "min-h-9 rounded-md px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          language === "en" && "bg-primary text-primary-foreground",
        )}
        onClick={() => setLanguage("en")}
      >
        {t("language.en.short")}
      </button>
      <button
        type="button"
        aria-pressed={language === "ja"}
        className={cn(
          "min-h-9 rounded-md px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          language === "ja" && "bg-primary text-primary-foreground",
        )}
        onClick={() => setLanguage("ja")}
      >
        {t("language.ja.short")}
      </button>
    </div>
  )
}

export type { Language, MessageKey }
