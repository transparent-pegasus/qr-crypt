import { Fingerprint } from "@/components/fingerprint"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/i18n"
import type { PqPublicBundleRecord } from "@/schemas/domain"

export interface PeerBundleDetailDialogProps {
  bundle: PqPublicBundleRecord | null
  // Computed by the page: a component must not import a page module.
  supported: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (record: PqPublicBundleRecord) => void
  onRevoke: (recordId: string) => void
  onDelete: (recordId: string) => void
}

export function PeerBundleDetailDialog({
  bundle,
  supported,
  busy,
  onOpenChange,
  onConfirm,
  onRevoke,
  onDelete,
}: PeerBundleDetailDialogProps) {
  const { t } = useI18n()
  const confirmed = bundle?.trust === "fingerprint-confirmed"

  return (
    <Dialog
      open={bundle !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onOpenChange(false)
      }}
    >
      <NoAutofocusDialogContent className="max-h-[95dvh] overflow-y-auto">
        {bundle !== null && (
          <div className="space-y-4 pb-14">
            <DialogHeader>
              <DialogTitle>
                {confirmed
                  ? (bundle.name ?? t("keyList.bundle.nameConfirmed"))
                  : t("keyList.bundle.nameUnverified")}
              </DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {bundle.identityId}
              </DialogDescription>
            </DialogHeader>

            <div>
              <Badge variant={supported && confirmed ? "default" : "secondary"}>
                {supported
                  ? confirmed
                    ? t("keyList.bundle.badge.confirmed")
                    : t("keyList.bundle.badge.unverified")
                  : t("keyDetail.badge.legacyProfile")}
              </Badge>
            </div>

            <Fingerprint
              label={t("keyList.bundle.fingerprintKem", {
                algorithm: bundle.kem.algorithm,
              })}
              value={bundle.kem.fingerprint}
            />
            <Fingerprint
              label={t("keyList.bundle.fingerprintSigning", {
                algorithm: bundle.signing.algorithm,
              })}
              value={bundle.signing.fingerprint}
            />
            <Fingerprint
              label={t("common.identityFingerprint")}
              value={bundle.identityFingerprint}
            />

            {!supported && (
              <p className="text-sm text-destructive">
                {t("keyList.bundle.legacyNote")}
              </p>
            )}

            {!confirmed && (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full cursor-pointer"
                disabled={busy}
                onClick={() => onConfirm(bundle)}
              >
                {t("keyList.bundle.confirmOpen")}
              </Button>
            )}

            <div
              className={`grid gap-2 ${
                supported ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
              }`}
            >
              {supported && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 cursor-pointer whitespace-normal"
                  disabled={busy}
                  onClick={() => onRevoke(bundle.recordId)}
                >
                  {t("keyList.bundle.revoke")}
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                className="h-auto min-h-11 cursor-pointer whitespace-normal"
                disabled={busy}
                onClick={() => onDelete(bundle.recordId)}
              >
                {t("common.delete")}
              </Button>
            </div>
          </div>
        )}
      </NoAutofocusDialogContent>
    </Dialog>
  )
}
