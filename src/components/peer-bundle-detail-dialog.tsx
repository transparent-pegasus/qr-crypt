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

interface PeerBundleDetailDialogProps {
  bundle: PqPublicBundleRecord | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (record: PqPublicBundleRecord) => void
  onRevoke: (recordId: string) => void
  onDelete: (recordId: string) => void
}

export function PeerBundleDetailDialog({
  bundle,
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
              <Badge variant={confirmed ? "default" : "secondary"}>
                {confirmed
                  ? t("keyList.bundle.badge.confirmed")
                  : t("keyList.bundle.badge.unverified")}
              </Badge>
            </div>

            <Fingerprint
              label={t("common.identityFingerprint")}
              value={bundle.identityFingerprint}
            />
            <details className="min-w-0 space-y-3 rounded-lg border p-3 text-muted-foreground">
              <summary className="cursor-pointer text-xs">
                {t("common.supplementalFingerprints")}
              </summary>
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
            </details>

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

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 cursor-pointer whitespace-normal"
                disabled={busy}
                onClick={() => onRevoke(bundle.recordId)}
              >
                {t("keyList.bundle.revoke")}
              </Button>
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
