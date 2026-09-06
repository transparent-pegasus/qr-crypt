import { Fingerprint } from "@/components/fingerprint"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/i18n"
import type { StoredKeyRecord } from "@/schemas/domain"

export function SymmetricImportView({
  record,
  name,
  acknowledged,
  busy,
  onNameChange,
  onAcknowledgedChange,
  onSave,
}: {
  record: StoredKeyRecord
  name: string
  acknowledged: boolean
  busy: boolean
  onNameChange: (name: string) => void
  onAcknowledgedChange: (acknowledged: boolean) => void
  onSave: () => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertTitle>{t("keys.symmetricImport.warnTitle")}</AlertTitle>
        <AlertDescription>{t("keys.symmetricImport.warnBody")}</AlertDescription>
      </Alert>
      <div className="space-y-2">
        <Label htmlFor="symmetric-import-name">
          {t("keys.symmetricImport.nameLabel")}
        </Label>
        <Input
          id="symmetric-import-name"
          value={name}
          maxLength={80}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>
      <Fingerprint
        label={t("keys.symmetricImport.fingerprintHint")}
        value={record.fingerprint}
      />
      <div className="flex items-start gap-2">
        <Checkbox
          id="symmetric-import-ack"
          checked={acknowledged}
          onCheckedChange={(checked) =>
            onAcknowledgedChange(checked === true)
          }
        />
        <Label htmlFor="symmetric-import-ack">
          {t("keys.symmetricImport.ackLabel")}
        </Label>
      </div>
      <DialogFooter>
        <Button
          type="button"
          disabled={busy || !acknowledged}
          onClick={() => void onSave()}
        >
          {t("keys.symmetricImport.saveButton")}
        </Button>
      </DialogFooter>
    </div>
  )
}
