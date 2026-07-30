import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  LANGUAGES,
  isMessageKey,
  translate,
  type InterpolationValues,
  type Language,
  type MessageKey,
} from "@/i18n/messages"
import { errorMessageKey, isErrorCode, type ErrorCode } from "@/crypto/errors"
import { OC_LOCAL_STORAGE_CLEARED_EVENT } from "@/storage/reset-events"

export const LANGUAGE_STORAGE_KEY = "oc-lang"
export const DELETE_ALL_CONFIRMATION = "DELETE ALL"
export const KEEP_KEYS_CONFIRMATION = "KEEP KEYS"

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value)
}

function languageNameKey(language: Language): MessageKey {
  return `language.${language}`
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
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n(): LanguageContextValue {
  return useContext(LanguageContext)
}

export function messageKeyOrFallback(message: unknown, fallback: MessageKey): MessageKey {
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

export function LanguageSelect({ id, className }: { id?: string; className?: string }) {
  const { language, setLanguage, t } = useI18n()

  return (
    <Select
      value={language}
      onValueChange={(value) => setLanguage(isLanguage(value) ? value : "en")}
    >
      <SelectTrigger
        id={id}
        // Callers that pass an id render their own visible <label>.
        aria-label={id ? undefined : t("language.field")}
        className={cn("h-11 w-auto min-w-40 text-base", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((option) => (
          <SelectItem key={option} value={option}>
            {t(languageNameKey(option))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// The labelled row for every screen that offers the language choice outside
// Settings. Those shells have no field chrome of their own, and one owner of the
// label keeps the boot, gate, and acknowledgement screens identical.
export function LanguageField() {
  const { t } = useI18n()
  const selectId = useId()

  return (
    <div className="flex items-center justify-between gap-3">
      <label
        htmlFor={selectId}
        className="select-none touch-manipulation text-sm font-medium text-muted-foreground"
      >
        {t("language.field")}
      </label>
      <LanguageSelect id={selectId} />
    </div>
  )
}

export type { Language, MessageKey }
