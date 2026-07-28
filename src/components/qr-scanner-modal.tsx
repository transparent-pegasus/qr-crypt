import { useCallback, useEffect, useRef, useState } from "react"
import { ScanLine } from "lucide-react"
import { AppError } from "@/crypto/errors"
import { warmQrReader } from "@/qr/decode"
import type { TransferState } from "@/qr/multipart/transfer-state"
import { QrScannerPanel } from "@/components/qr-scanner-panel"
import {
  deliveryError,
  localized,
  localizedErrorCode,
  type LocalizedText,
  type QrScannerPanelProps,
} from "@/components/qr-scanner-shared"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"

export type QrScannerModalProps = QrScannerPanelProps & {
  triggerLabel: string
  triggerDisabled?: boolean
  onClosed?: () => void
  className?: string
}

export function QrScannerModal(props: QrScannerModalProps) {
  const { t } = useI18n()
  const {
    triggerLabel,
    triggerDisabled = false,
    onClosed,
    cameraAvailable = true,
    title: titleProp,
    stopHint: stopHintProp,
    className,
  } = props
  const title = titleProp ?? t("scanner.defaultTitle")
  const stopHint = stopHintProp ?? t("scanner.stopHint.modal")
  const multipartSession = props.multipart?.session
  const multipartRef = useRef(props.multipart)
  const contentRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const openRef = useRef(false)
  const openGenerationRef = useRef(0)
  const deliveryBusyRef = useRef(false)
  const automaticCloseRef = useRef(false)
  const previousClosedKindRef = useRef<TransferState["kind"]>(
    multipartSession?.state().kind ?? "idle",
  )
  const [open, setOpen] = useState(false)
  const [deliveryBusy, setDeliveryBusy] = useState(false)
  const [closedNotice, setClosedNotice] = useState<LocalizedText | null>(null)
  const localizedClosedNotice =
    closedNotice === null
      ? null
      : t(closedNotice.key, closedNotice.values)

  // Take the one-megabyte reader fetch off the acquisition path: warming here means the
  // binary is normally compiled before the user ever taps start.
  useEffect(() => {
    warmQrReader()
  }, [])

  const beginDelivery = useCallback((): boolean => {
    if (deliveryBusyRef.current) return false
    deliveryBusyRef.current = true
    if (mountedRef.current) setDeliveryBusy(true)
    return true
  }, [])

  const endDelivery = useCallback(() => {
    deliveryBusyRef.current = false
    if (mountedRef.current) setDeliveryBusy(false)
  }, [])

  useEffect(() => {
    multipartRef.current = props.multipart
  }, [props.multipart])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      openGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    previousClosedKindRef.current = multipartSession?.state().kind ?? "idle"
  }, [multipartSession])

  useEffect(() => {
    if (open || multipartSession === undefined) return
    let polling = true

    const inspectClosedSession = async () => {
      if (
        !polling ||
        openRef.current ||
        deliveryBusyRef.current
      ) {
        return
      }
      const generation = openGenerationRef.current
      const canPublish = () =>
        polling &&
        mountedRef.current &&
        !openRef.current &&
        openGenerationRef.current === generation
      const previousKind = previousClosedKindRef.current
      const next = multipartSession.state()
      previousClosedKindRef.current = next.kind

      if (next.kind === "collecting") {
        if (canPublish()) {
          setClosedNotice(
            localized("scanner.closed.multipartProgress", {
              received: next.receivedIndexes.size,
              total: next.frameCount,
            }),
          )
        }
        return
      }
      if (next.kind === "idle") {
        if (previousKind === "collecting" && canPublish()) {
          setClosedNotice(localized("scanner.error.expiredDiscarded"))
        }
        return
      }
      if (next.kind === "error") {
        if (canPublish()) setClosedNotice(localizedErrorCode(next.code))
        return
      }
      if (!beginDelivery()) return
      try {
        if (!multipartSession.claimCompletion()) return
        const onComplete = multipartRef.current?.onComplete
        if (onComplete === undefined) return
        await onComplete({
          artifactType: next.artifactType,
          artifactBytes: next.artifactBytes,
        })
        if (canPublish()) {
          setClosedNotice(
            localized("scanner.closed.integrityImported"),
          )
          onClosed?.()
        }
      } catch (caught) {
        if (canPublish()) {
          setClosedNotice(localizedErrorCode(deliveryError(caught).code))
        }
      } finally {
        endDelivery()
      }
    }

    void inspectClosedSession()
    const timer = window.setInterval(() => {
      void inspectClosedSession()
    }, 1_000)
    return () => {
      polling = false
      window.clearInterval(timer)
    }
  }, [beginDelivery, endDelivery, multipartSession, onClosed, open])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && deliveryBusyRef.current) return
    openRef.current = nextOpen
    if (nextOpen) {
      openGenerationRef.current += 1
      automaticCloseRef.current = false
      previousClosedKindRef.current =
        multipartSession?.state().kind ?? "idle"
      setClosedNotice(null)
    }
    setOpen(nextOpen)
  }

  const panelGeneration = openGenerationRef.current
  const deliverFromPanel = async (
    generation: number,
    operation: () => void | Promise<void>,
    successNotice?: LocalizedText,
  ) => {
    if (!beginDelivery()) throw new AppError("INVALID_QR_PAYLOAD")
    try {
      await operation()
      const sameGeneration =
        mountedRef.current && openGenerationRef.current === generation
      if (sameGeneration && successNotice !== undefined) {
        setClosedNotice(successNotice)
      }
      if (openRef.current && sameGeneration) {
        automaticCloseRef.current = true
        openRef.current = false
        setOpen(false)
      }
    } catch (caught) {
      if (
        openRef.current &&
        mountedRef.current &&
        openGenerationRef.current === generation
      ) {
        throw caught
      }
      if (
        mountedRef.current &&
        openGenerationRef.current === generation
      ) {
        setClosedNotice(localizedErrorCode(deliveryError(caught).code))
      }
    } finally {
      endDelivery()
    }
  }

  const panel =
    props.multipart === undefined ? (
      <QrScannerPanel
        singleTargets={props.singleTargets}
        onSingleScan={(target, payload) =>
          deliverFromPanel(panelGeneration, () =>
            props.onSingleScan(target, payload),
          )
        }
        cameraAvailable={cameraAvailable}
        title={title}
        autoStart
        stopHint={stopHint}
      />
    ) : (
      <QrScannerPanel
        singleTargets={props.singleTargets}
        onSingleScan={(target, payload) =>
          deliverFromPanel(panelGeneration, () =>
            props.onSingleScan(target, payload),
          )
        }
        cameraAvailable={cameraAvailable}
        title={title}
        autoStart
        stopHint={stopHint}
        multipart={{
          session: props.multipart.session,
          onComplete: (completion) =>
            deliverFromPanel(
              panelGeneration,
              () => props.multipart?.onComplete(completion),
              localized("scanner.closed.integrityImported"),
            ),
        }}
      />
    )

  return (
    <div
      className={cn("space-y-2", className)}
      aria-busy={deliveryBusy}
    >
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            type="button"
            className="h-11 w-full"
            disabled={!cameraAvailable || triggerDisabled || deliveryBusy}
          >
            <ScanLine aria-hidden="true" />
            {triggerLabel}
          </Button>
        </DialogTrigger>
        <DialogContent
          ref={contentRef}
          tabIndex={-1}
          className="grid max-h-[95dvh] max-w-lg grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-4"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            contentRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (automaticCloseRef.current) event.preventDefault()
            automaticCloseRef.current = false
            if (!openRef.current) onClosed?.()
          }}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {/* 4rem prior chrome + ~44px close row + 1rem grid gap */}
          <div
            data-qr-scanner-scroll-region
            className="min-h-0 max-h-[calc(95dvh-4rem)] overflow-y-auto pb-14"
          >
            {open && panel}
          </div>
        </DialogContent>
      </Dialog>
      {!cameraAvailable && (
        <p className="text-sm text-muted-foreground">
          {t("scanner.error.cameraUnavailable")}
        </p>
      )}
      {closedNotice && (
        <p
          aria-live="polite"
          className="whitespace-pre-line text-sm text-muted-foreground"
        >
          {localizedClosedNotice}
        </p>
      )}
    </div>
  )
}
