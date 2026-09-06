import type { PendingDelete } from "@/components/key-detail/types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useI18n } from "@/i18n"

export function DeleteConfirm({
  open,
  target,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  target: PendingDelete | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target
              ? t("keyDetail.delete.titleNamed", { name: target.name })
              : t("keyDetail.delete.titleGeneric")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target?.kind === "identity"
              ? t("keyDetail.delete.body.identity")
              : t("keyDetail.delete.body.symmetric")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void onConfirm()}
          >
            {t("keyDetail.delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
