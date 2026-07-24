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
  title = "QRコード",
  onRendered,
  fullscreenEnabled = true,
}: QrDisplayProps) {
  const identity = `${payload}\u0000${ecLevel}\u0000${size}`
  const [rendered, setRendered] = useState<{
    identity: string
    dataUrl: string | null
    error: string | null
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
            error: "本アプリのペイロードではないためQRコードを生成できません。",
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
            error: toAppError(caught, "QR_TOO_LARGE").userMessage,
          })
        }
      })
    return () => {
      active = false
    }
  }, [ecLevel, identity, payload, size])

  const dataUrl = rendered.identity === identity ? rendered.dataUrl : null
  const error = rendered.identity === identity ? rendered.error : null

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle aria-hidden="true" className="size-4" />
        <AlertTitle>QRコードを生成できません</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`${title}の画像`}
            width={size}
            height={size}
            className="mx-auto h-auto w-full max-w-[512px] bg-white"
          />
        ) : (
          <div
            aria-live="polite"
            className="grid aspect-square w-full place-items-center text-sm text-slate-600"
          >
            QRコードを生成しています…
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          データサイズ: {new TextEncoder().encode(payload).byteLength} bytes / EC=
          {ecLevel}
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
            全画面表示
          </Button>
        )}
      </div>

      {fullscreenEnabled && (
        <Dialog open={fullscreen} onOpenChange={setFullscreen}>
          <DialogContent className="h-dvh max-w-none border-0 bg-white p-4 text-slate-950 sm:rounded-none [&>button.absolute]:hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>{title}を全画面表示</DialogTitle>
              <DialogDescription>
                白い背景にQRコードを全画面で表示します。
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
              {dataUrl && (
                <img
                  src={dataUrl}
                  alt={`${title}の全画面画像`}
                  width={size}
                  height={size}
                  className="h-auto w-[min(90vw,512px)] bg-white"
                />
              )}
              <p className="text-center text-sm text-slate-700">
                画面の輝度を上げると読み取りやすくなります
              </p>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 min-w-32 cursor-pointer border-slate-300 bg-white text-slate-950 focus-visible:ring-2"
                >
                  <X aria-hidden="true" />
                  閉じる
                </Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
