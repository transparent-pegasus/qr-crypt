import { en } from "@/i18n/catalog-en"
import { ja } from "@/i18n/catalog-ja"
import { interpolateMessage, type InterpolationValues } from "@/i18n/interpolate"

export const LANGUAGES = ["en", "ja"] as const
export type Language = (typeof LANGUAGES)[number]

export type MessageKey = keyof typeof en
export type MessageCatalog = Readonly<Record<MessageKey, string>>

const MESSAGE_KEY_SET: ReadonlySet<string> = new Set(Object.keys(en))

export const messages: Readonly<Record<Language, MessageCatalog>> = { en, ja }

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && MESSAGE_KEY_SET.has(value)
}

export function translate(
  language: Language,
  key: MessageKey,
  values: InterpolationValues = {},
): string {
  return interpolateMessage(messages[language][key], values)
}
