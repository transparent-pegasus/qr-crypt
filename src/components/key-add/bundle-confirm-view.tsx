import { Fingerprint } from "@/components/fingerprint"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/i18n"
import type { PqPublicBundleRecord } from "@/schemas/domain"

export function BundleConfirmView({
  bundle,
  fingerprintChecked,
  busy,
  onFingerprintCheckedChange,
  onSave,
}: {
  bundle: PqPublicBundleRecord
  fingerprintChecked: boolean
  busy: boolean
  onFingerprintCheckedChange: (checked: boolean) => void
  onSave: (confirmed: boolean) => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <Fingerprint
        label={t("common.identityFingerprint")}
        value={bundle.identityFingerprint}
      />
      <Fingerprint
        label={t("keys.bundle.fingerprintKem")}
        value={bundle.kem.fingerprint}
      />
      <Fingerprint
        label={t("keys.bundle.fingerprintSigning")}
        value={bundle.signing.fingerprint}
      />
      <div className="flex items-start gap-2">
        <Checkbox
          id="fingerprint-confirmed"
          checked={fingerprintChecked}
          onCheckedChange={(checked) => onFingerprintCheckedChange(checked === true)}
        />
        <Label htmlFor="fingerprint-confirmed">
          {t("keys.bundle.confirmLabel")}
        </Label>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void onSave(false)}
        >
          {t("keys.bundle.saveUnverified")}
        </Button>
        <Button
          type="button"
          disabled={busy || !fingerprintChecked}
          onClick={() => void onSave(true)}
        >
          {t("keys.bundle.saveConfirmed")}
        </Button>
      </DialogFooter>
    </div>
  )
}
