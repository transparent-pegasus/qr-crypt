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
import { formatDateTime } from "@/features/presentation"
import { useI18n } from "@/i18n"
import type { PostQuantumIdentity } from "@/schemas/domain"

export function DestroySupersededConfirm({
  open,
  generations,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  generations: PostQuantumIdentity[] | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}) {
  const { language, t } = useI18n()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("keyDetail.destroy.title", {
              count: generations?.length ?? 0,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("keyDetail.destroy.body", {
              dates: (generations ?? [])
                .map((generation) =>
                  formatDateTime(generation.createdAt, language),
                )
                .join(", "),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => void onConfirm()}
          >
            {t("keyDetail.destroy.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
