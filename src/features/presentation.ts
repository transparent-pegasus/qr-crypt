import { translate, type Language } from "@/i18n/messages"
import type { UiAlgorithm } from "@/schemas/domain"

export const ALGORITHM_LABELS: Record<
  Language,
  Record<UiAlgorithm, string>
> = {
  en: {
    A256GCM: translate("en", "algorithm.A256GCM"),
    MLKEM1024_A256GCM: translate("en", "algorithm.MLKEM1024_A256GCM"),
    MLKEM1024_MLDSA87_A256GCM: translate(
      "en",
      "algorithm.MLKEM1024_MLDSA87_A256GCM",
    ),
  },
  ja: {
    A256GCM: translate("ja", "algorithm.A256GCM"),
    MLKEM1024_A256GCM: translate("ja", "algorithm.MLKEM1024_A256GCM"),
    MLKEM1024_MLDSA87_A256GCM: translate(
      "ja",
      "algorithm.MLKEM1024_MLDSA87_A256GCM",
    ),
  },
}

export function formatDateTime(
  timestamp: number | undefined,
  language: Language,
): string {
  if (timestamp === undefined) return translate(language, "common.unused")
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
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

export function formatFingerprint(fingerprintHex: string): string {
  const normalized = fingerprintHex.replaceAll(/[^0-9a-f]/gi, "")
  if (normalized.length < 16) return fingerprintHex
  const groups: string[] = []
  for (let offset = 0; offset < 16; offset += 4) {
    const value = Number.parseInt(normalized.slice(offset, offset + 4), 16)
    groups.push(String(value % 10_000).padStart(4, "0"))
  }
  return groups.join(" ")
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

export function shortTechnicalId(value: string | undefined): string {
  if (!value) return "—"
  return value.length > 8 ? `${value.slice(0, 8)}…` : value
}

export function isQryptPayload(payload: string): boolean {
  return /^OC(?:M1|K1|P1|B1|M2|P2|S2|I2|B2|F2):/.test(payload)
}
