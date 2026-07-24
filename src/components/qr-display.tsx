import { useEffect, useRef, useState } from "react"
import { AlertCircle, Expand, X } from "lucide-react"
import { renderQrDataUrl } from "@/qr/encode"
import type { QrEcLevel } from "@/schemas/domain"
import { isQryptPayload } from "@/features/presentation"
import { toAppError } from "@/crypto/errors"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"

export interface QrDisplayProps {
  payload: string
  ecLevel: QrEcLevel
  size?: number
  title?: string
  onRendered?: () => void
  fullscreenEnabled?: boolean
}

export function QrDisplay({
  payload,
  ecLevel,
  size = 512,
  title: titleProp,
  onRendered,
  fullscreenEnabled = true,
}: QrDisplayProps) {
  const { t } = useI18n()
  const title = titleProp ?? t("qrDisplay.defaultTitle")
  const identity = `${payload}\u0000${ecLevel}\u0000${size}`
  const [rendered, setRendered] = useState<{
    identity: string
    dataUrl: string | null
    error: LocalizedMessage | null
  }>({ identity: "", dataUrl: null, error: null })
  const [fullscreen, setFullscreen] = useState(false)
  const renderedCallbackRef = useRef(onRendered)
  useEffect(() => {
    renderedCallbackRef.current = onRendered
  }, [onRendered])

  useEffect(() => {
    let active = true
    if (!isQryptPayload(payload)) {
      queueMicrotask(() => {
        if (active) {
          setRendered({
            identity,
            dataUrl: null,
            error: "qrDisplay.notQryptPayload",
          })
        }
      })
      return () => {
        active = false
      }
    }
    void renderQrDataUrl(payload, { ecLevel, size })
      .then((url) => {
        if (!active) return
        setRendered({ identity, dataUrl: url, error: null })
        renderedCallbackRef.current?.()
      })
      .catch((caught: unknown) => {
        if (active) {
          setRendered({
            identity,
            dataUrl: null,
            error: toAppError(caught, "QR_TOO_LARGE").code,
          })
        }
      })
    return () => {
      active = false
    }
  }, [ecLevel, identity, payload, size])

  const dataUrl = rendered.identity === identity ? rendered.dataUrl : null
  const error = rendered.identity === identity ? rendered.error : null
  const localizedError = useLocalizedMessage(error)

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle aria-hidden="true" className="size-4" />
        <AlertTitle>{t("qrDisplay.error.title")}</AlertTitle>
        <AlertDescription>{localizedError}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={t("qrDisplay.image.alt", { title })}
            width={size}
            height={size}
            className="mx-auto h-auto w-full max-w-[512px] bg-white"
          />
        ) : (
          <div
            aria-live="polite"
            className="grid aspect-square w-full place-items-center text-sm text-slate-600"
          >
            {t("qrDisplay.generating")}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {t("qrDisplay.dataSize", {
            bytes: new TextEncoder().encode(payload).byteLength,
            ecLevel,
          })}
        </span>
        {fullscreenEnabled && (
          <Button
            type="button"
            variant="outline"
            className="h-11 cursor-pointer focus-visible:ring-2"
            disabled={!dataUrl}
            onClick={() => setFullscreen(true)}
          >
            <Expand aria-hidden="true" />
            {t("qrDisplay.fullscreen.button")}
          </Button>
        )}
      </div>

      {fullscreenEnabled && (
        <Dialog open={fullscreen} onOpenChange={setFullscreen}>
          <DialogContent className="h-dvh max-w-none border-0 bg-white p-4 text-slate-950 sm:rounded-none [&>button.absolute]:hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>
                {t("qrDisplay.fullscreen.title", { title })}
              </DialogTitle>
              <DialogDescription>
                {t("qrDisplay.fullscreen.desc")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
              {dataUrl && (
                <img
                  src={dataUrl}
                  alt={t("qrDisplay.fullscreen.imageAlt", { title })}
                  width={size}
                  height={size}
                  className="h-auto w-[min(90vw,512px)] bg-white"
                />
              )}
              <p className="text-center text-sm text-slate-700">
                {t("qrDisplay.fullscreen.brightnessHint")}
              </p>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-w-32 cursor-pointer border-slate-300 bg-white text-slate-950 focus-visible:ring-2"
                >
                  <X aria-hidden="true" />
                  {t("common.close")}
                </Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
