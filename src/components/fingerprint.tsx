import { useI18n } from "@/i18n"
import { formatFingerprint } from "@/features/presentation"

export function Fingerprint({ label, value }: { label: string; value: string }) {
  const { t } = useI18n()
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="font-mono text-sm [overflow-wrap:anywhere]">
        {t("common.fingerprintCompare", { value: formatFingerprint(value) })}
      </p>
    </div>
  )
}
