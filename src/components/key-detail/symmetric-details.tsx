import { QrCode, Trash2 } from "lucide-react"
import { Fingerprint } from "@/components/fingerprint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/features/presentation"
import { useI18n } from "@/i18n"
import type { StoredKeyRecord } from "@/schemas/domain"

export function SymmetricDetails({
  record,
  busy,
  onShow,
  onDelete,
}: {
  record: StoredKeyRecord
  busy: boolean
  onShow: () => void
  onDelete: () => void
}) {
  const { language, t } = useI18n()
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="break-all font-mono text-xs text-muted-foreground">{record.id}</p>
        <Badge>AES-256-GCM</Badge>
      </div>
      <Fingerprint
        label={t("keyDetail.symmetric.fingerprintLabel")}
        value={record.fingerprint}
      />
      <p className="text-xs text-muted-foreground">
        {t("common.created", {
          datetime: formatDateTime(record.createdAt, language),
        })}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {record.status === "active" && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={onShow}
          >
            <QrCode aria-hidden="true" />
            {t("keyDetail.button.showSecretQr")}
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          className="h-11"
          disabled={busy}
          aria-label={t("common.deleteAriaLabel", { name: record.name })}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
          {t("common.delete")}
        </Button>
      </div>
    </div>
  )
}
