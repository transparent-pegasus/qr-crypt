import { useEffect, useRef, useState, type ReactNode } from "react"
import { AlertCircle, Expand, X } from "lucide-react"
import { renderQrDataUrl } from "@/qr/encode"
import type { QrEcLevel } from "@/schemas/domain"
import { isQrCryptPayload } from "@/features/presentation"
import { toAppError } from "@/crypto/errors"
import { cn } from "@/lib/utils"
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
import { useI18n, useLocalizedMessage, type LocalizedMessage } from "@/i18n"

export interface QrDisplayProps {
  payload: string
  ecLevel: QrEcLevel
  size?: number
  title?: string
  onRendered?: (payload: string) => void
  fullscreenEnabled?: boolean
  showFullscreenTrigger?: boolean
  fullscreenControls?: QrDisplayFullscreenControls
  fullscreenOpen?: boolean
  onFullscreenOpenChange?: (open: boolean) => void
}

export type QrDisplayFullscreenControls =
  | {
      kind: "transport"
      render: (closeSlot: ReactNode) => ReactNode
    }
  | {
      kind: "arbitrary"
      content: ReactNode
    }

interface QrRenderRequest {
  id: number
  identity: string
  payload: string
  ecLevel: QrEcLevel
  size: number
}

export function QrDisplay({
  payload,
  ecLevel,
  size = 512,
  title: titleProp,
  onRendered,
  fullscreenEnabled = true,
  showFullscreenTrigger = true,
  fullscreenControls,
  fullscreenOpen,
  onFullscreenOpenChange,
}: QrDisplayProps) {
  const { t } = useI18n()
  const title = titleProp ?? t("qrDisplay.defaultTitle")
  const identity = `${payload}\u0000${ecLevel}\u0000${size}`
  const payloadIsValid = isQrCryptPayload(payload)
  const [rendered, setRendered] = useState<{
    identity: string
    payload: string
    dataUrl: string | null
    error: LocalizedMessage | null
  }>({ identity: "", payload: "", dataUrl: null, error: null })
  const [uncontrolledFullscreen, setUncontrolledFullscreen] = useState(false)
  const fullscreen = fullscreenOpen ?? uncontrolledFullscreen
  const changeFullscreen = (open: boolean) => {
    if (fullscreenOpen === undefined) setUncontrolledFullscreen(open)
    onFullscreenOpenChange?.(open)
  }
  const renderedCallbackRef = useRef(onRendered)
  const mountedRef = useRef(true)
  const nextRenderRequestIdRef = useRef(0)
  const currentRenderRequestIdRef = useRef(0)
  const invalidatedThroughRequestIdRef = useRef(0)
  // Keep one render active and only the newest pending target. A completed
  // frame remains visible while that target renders, without building a backlog.
  const queuedRenderRef = useRef<QrRenderRequest | null>(null)
  const activeRenderRequestIdRef = useRef<number | null>(null)
  useEffect(() => {
    renderedCallbackRef.current = onRendered
  }, [onRendered])
  // Effects run after the successful render state has committed, so animation
  // dwell never starts merely because the asynchronous encoder resolved.
  useEffect(() => {
    if (rendered.dataUrl === null || rendered.error !== null) return
    renderedCallbackRef.current?.(rendered.payload)
  }, [rendered.dataUrl, rendered.error, rendered.identity, rendered.payload])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      invalidatedThroughRequestIdRef.current = nextRenderRequestIdRef.current
      queuedRenderRef.current = null
      activeRenderRequestIdRef.current = null
    }
  }, [])

  useEffect(() => {
    const requestId = nextRenderRequestIdRef.current + 1
    nextRenderRequestIdRef.current = requestId
    currentRenderRequestIdRef.current = requestId

    if (!payloadIsValid) {
      // Invalid input is a hard boundary: no older in-flight result may reappear.
      invalidatedThroughRequestIdRef.current = requestId
      queuedRenderRef.current = null
      queueMicrotask(() => {
        if (
          mountedRef.current &&
          currentRenderRequestIdRef.current === requestId
        ) {
          setRendered({
            identity,
            payload,
            dataUrl: null,
            error: "qrDisplay.notQrCryptPayload",
          })
        }
      })
      return
    }

    queuedRenderRef.current = {
      id: requestId,
      identity,
      payload,
      ecLevel,
      size,
    }

    const renderNext = () => {
      if (
        !mountedRef.current ||
        activeRenderRequestIdRef.current !== null
      ) {
        return
      }
      const request = queuedRenderRef.current
      if (request === null) return

      queuedRenderRef.current = null
      activeRenderRequestIdRef.current = request.id
      void renderQrDataUrl(request.payload, {
        ecLevel: request.ecLevel,
        size: request.size,
      })
        .then((url) => {
          if (
            !mountedRef.current ||
            request.id <= invalidatedThroughRequestIdRef.current
          ) {
            return
          }
          // A newer valid target may already be queued. Commit this successful
          // frame first so a slow renderer lowers frame rate instead of blanking.
          setRendered({
            identity: request.identity,
            payload: request.payload,
            dataUrl: url,
            error: null,
          })
        })
        .catch((caught: unknown) => {
          if (
            !mountedRef.current ||
            request.id <= invalidatedThroughRequestIdRef.current
          ) {
            return
          }
          const requestIsCurrent =
            currentRenderRequestIdRef.current === request.id
          // A known render failure always clears the displayed QR. Surface the
          // error only while that failed request is still the active target.
          invalidatedThroughRequestIdRef.current = request.id
          setRendered({
            identity: request.identity,
            payload: request.payload,
            dataUrl: null,
            error: requestIsCurrent
              ? toAppError(caught, "QR_TOO_LARGE").code
              : null,
          })
        })
        .finally(() => {
          if (activeRenderRequestIdRef.current === request.id) {
            activeRenderRequestIdRef.current = null
          }
          renderNext()
        })
    }

    renderNext()
  }, [ecLevel, identity, payload, payloadIsValid, size])

  const invalidPayloadError: LocalizedMessage | null = payloadIsValid
    ? null
    : "qrDisplay.notQrCryptPayload"
  const error =
    invalidPayloadError ??
    (rendered.identity === identity ? rendered.error : null)
  const dataUrl =
    payloadIsValid && error === null ? rendered.dataUrl : null
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

  const fullscreenClose = (
    <DialogClose asChild>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 shrink-0 cursor-pointer border border-slate-300 bg-white text-slate-950 hover:bg-slate-100 hover:text-slate-950 focus-visible:ring-2"
        aria-label={t("common.close")}
      >
        <X aria-hidden="true" />
      </Button>
    </DialogClose>
  )
  const hasArbitraryFullscreenControls = fullscreenControls?.kind === "arbitrary"

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
        {fullscreenEnabled && showFullscreenTrigger && (
          <Button
            type="button"
            variant="outline"
            className="h-11 cursor-pointer focus-visible:ring-2"
            disabled={!dataUrl}
            onClick={() => changeFullscreen(true)}
          >
            <Expand aria-hidden="true" />
            {t("qrDisplay.fullscreen.button")}
          </Button>
        )}
      </div>

      {fullscreenEnabled && (
        <Dialog open={fullscreen} onOpenChange={changeFullscreen}>
          <DialogContent
            hideCloseButton
            className={cn(
              // w-full: this surface is deliberately full-bleed, overriding the
              // inset default DialogContent gives ordinary modals.
              "grid h-dvh w-full min-w-0 max-w-none grid-cols-[minmax(0,1fr)] gap-3 overflow-hidden border-0 bg-white text-slate-950 [padding-block-end:max(1rem,env(safe-area-inset-bottom))] [padding-block-start:max(1rem,env(safe-area-inset-top))] [padding-inline-end:max(1rem,env(safe-area-inset-right))] [padding-inline-start:max(1rem,env(safe-area-inset-left))] sm:rounded-none",
              hasArbitraryFullscreenControls
                ? "grid-rows-[minmax(0,1fr)_auto_auto]"
                : "grid-rows-[minmax(0,1fr)_auto]",
            )}
          >
            <DialogHeader className="sr-only">
              <DialogTitle>{t("qrDisplay.fullscreen.title", { title })}</DialogTitle>
              <DialogDescription>{t("qrDisplay.fullscreen.desc")}</DialogDescription>
            </DialogHeader>
            <div className="row-start-1 grid min-h-0 min-w-0 place-items-center overflow-hidden">
              {dataUrl && (
                <img
                  src={dataUrl}
                  alt={t("qrDisplay.fullscreen.imageAlt", { title })}
                  width={size}
                  height={size}
                  className="h-full min-h-0 min-w-0 max-h-full w-auto max-w-full object-contain bg-white"
                />
              )}
            </div>
            {fullscreenControls?.kind === "transport" ? (
              <div className="row-start-2 min-w-0">
                {fullscreenControls.render(fullscreenClose)}
              </div>
            ) : (
              <>
                {hasArbitraryFullscreenControls && (
                  <div className="row-start-2 min-w-0">
                    {fullscreenControls.content}
                  </div>
                )}
                <div
                  data-fullscreen-close-row
                  className={cn(
                    // w-fit, not a full-width row: the close is its own rounded box.
                    "w-fit min-w-0 justify-self-end",
                    hasArbitraryFullscreenControls ? "row-start-3" : "row-start-2",
                  )}
                >
                  {fullscreenClose}
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
