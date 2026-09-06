import { KeyRound } from "lucide-react"
import { QrScannerModal } from "@/components/qr-scanner-modal"
import type { QrScannerPanelProps } from "@/components/qr-scanner-shared"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { MultipartScanSession } from "@/features/multipart-scan-session"
import { useI18n } from "@/i18n"

export function ImportSourceView({
  cameraAvailable,
  scanSession,
  importPayload,
  busy,
  onComplete,
  onPasteChange,
  onReadPaste,
}: {
  cameraAvailable: boolean
  scanSession: MultipartScanSession
  importPayload: string
  busy: boolean
  onComplete: QrScannerPanelProps["multipart"]["onComplete"]
  onPasteChange: (value: string) => void
  onReadPaste: () => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <Card aria-labelledby="camera-import-title">
        <CardHeader className="p-4 pb-3">
          <h3
            id="camera-import-title"
            className="font-semibold leading-none tracking-tight"
          >
            {t("keys.import.cameraTitle")}
          </h3>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <p className="text-sm text-muted-foreground">{t("keys.demo.hint")}</p>
          <QrScannerModal
            triggerLabel={t("keys.import.scanTrigger")}
            cameraAvailable={cameraAvailable}
            title={t("keys.import.scanTrigger")}
            multipart={{
              session: scanSession,
              onComplete: (completion) => onComplete(completion),
            }}
          />
        </CardContent>
      </Card>
      <Card aria-labelledby="paste-import-title">
        <CardHeader className="p-4 pb-3">
          <h3
            id="paste-import-title"
            className="font-semibold leading-none tracking-tight"
          >
            {t("common.pastePayload")}
          </h3>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-2">
            <Label htmlFor="key-payload">{t("keys.import.payloadLabel")}</Label>
            <Textarea
              id="key-payload"
              value={importPayload}
              onChange={(event) => onPasteChange(event.target.value)}
              placeholder={t("keys.import.payloadPlaceholder")}
              className="min-h-28 break-all font-mono"
            />
            <Button
              type="button"
              className="h-11 w-full"
              disabled={busy || !importPayload.trim()}
              onClick={() => void onReadPaste()}
            >
              <KeyRound aria-hidden="true" />
              {t("keys.import.readButton")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
