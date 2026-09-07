import { translate, type Language } from "@/i18n/messages"

export function formatDateTime(
  timestamp: number | undefined,
  language: Language,
): string {
  if (timestamp === undefined) return translate(language, "common.unused")
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return "—"
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatSuggestedDate(timestamp: number): string {
  const date = new Date(timestamp)
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ]
  return parts.join("")
}

export function formatFingerprint(value: string): string {
  const normalized = value.replaceAll(/[^0-9a-f]/gi, "").toLowerCase()
  return normalized.match(/.{1,4}/g)?.join(" ") ?? ""
}

export function formatFramePositions(
  indexes: readonly number[],
  language: Language,
): string {
  return indexes.length === 0
    ? translate(language, "common.none")
    : indexes
        .map((index) =>
          translate(language, "presentation.framePosition", {
            position: index + 1,
          }),
        )
        .join(translate(language, "presentation.frameSeparator"))
}
