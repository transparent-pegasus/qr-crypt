import { QrCode, RefreshCw, Trash2 } from "lucide-react"
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
  onRotate,
  onDelete,
}: {
  record: StoredKeyRecord
  busy: boolean
  onShow: () => void
  onRotate: () => void
  onDelete: () => void
}) {
  const { language, t } = useI18n()
  const old = record.status !== "active"
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="break-all font-mono text-xs text-muted-foreground">{record.id}</p>
        <div className="shrink-0 space-y-1 text-right">
          <Badge variant={old ? "secondary" : "default"}>
            {t(`keyStatus.${record.status}`)}
          </Badge>
          <p className="text-xs text-muted-foreground">AES-256-GCM</p>
        </div>
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
          <>
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
            <Button
              type="button"
              variant="secondary"
              className="h-11"
              disabled={busy}
              onClick={onRotate}
            >
              <RefreshCw aria-hidden="true" />
              {t("keyDetail.button.rotate")}
            </Button>
          </>
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
