import type { ReactNode } from "react"
import { Clipboard, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n"

export function SymmetricQrView({
  children,
  busy,
  onCopy,
  onExport,
}: {
  children: ReactNode
  busy: boolean
  onCopy: () => Promise<void>
  onExport: () => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      {children}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={busy}
          onClick={() => void onCopy()}
        >
          <Clipboard aria-hidden="true" />
          {t("common.copy")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={busy}
          onClick={() => void onExport()}
        >
          <Download aria-hidden="true" />
          {t("common.download")}
        </Button>
      </div>
    </div>
  )
}
