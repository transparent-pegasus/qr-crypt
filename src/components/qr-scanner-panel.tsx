import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  Camera,
  RefreshCw,
  ScanLine,
  Trash2,
} from "lucide-react"
import { AppError } from "@/crypto/errors"
import type { MultipartScanSession } from "@/features/multipart-scan-session"
import { formatFramePositions } from "@/features/presentation"
import { useQrReaderReadiness } from "@/hooks/use-qr-reader-readiness"
import { reloadApplication } from "@/lib/reload"
import {
  shouldRestartQrScanOnVisibility,
  startQrScan,
  type CameraFailureState,
  type CameraScanState,
  type QrScanHandle,
} from "@/qr/decode"
import type { TransferState } from "@/qr/multipart/transfer-state"
import { QR_PREFIX_V2 } from "@/qr/payload-v2"
import {
  deliveryError,
  localized,
  localizedErrorCode,
  type LocalizedText,
  type QrScannerPanelProps,
} from "@/components/qr-scanner-shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useI18n } from "@/i18n"

type ScannerMode = "idle" | "running" | "delivering" | "stopped"

interface ScannerRun {
  id: number
  abortController: AbortController
  handle: QrScanHandle | null
  session: MultipartScanSession
  cancelled: boolean
  errorReported: boolean
  emitted: boolean
}

const IDLE_TRANSFER_STATE: TransferState = { kind: "idle" }

export function QrScannerPanel(props: QrScannerPanelProps) {
  const { language, t } = useI18n()
  const readiness = useQrReaderReadiness()
  const readinessRef = useRef(readiness)
  const readyAtMountRef = useRef(readiness === "ready")
  const {
    cameraAvailable = true,
    title: titleProp,
    autoStart = false,
    stopHint: stopHintProp,
  } = props
  const title = titleProp ?? t("scanner.defaultTitle")
  const multipart = props.multipart
  const multipartSession = multipart.session
  const resolvedStopHint = stopHintProp ?? t("scanner.stopHint.multipart")

  const videoRef = useRef<HTMLVideoElement>(null)
  const mountedRef = useRef(true)
  const cameraAvailableRef = useRef(cameraAvailable)
  const multipartRef = useRef(multipart)
  const activeRunRef = useRef<ScannerRun | null>(null)
  const nextRunIdRef = useRef(0)
  const startLockedRef = useRef(false)
  const cameraModeRef = useRef<ScannerMode>("idle")
  const cameraStateRef = useRef<CameraScanState>("idle")
  const [transferState, setTransferState] = useState<TransferState>(
    () => multipartSession.state(),
  )
  const previousTransferKindRef = useRef<TransferState["kind"]>(
    transferState.kind,
  )

  const [cameraMode, setCameraMode] = useState<ScannerMode>("idle")
  const [cameraStatus, setCameraStatus] = useState<LocalizedText>(
    () => localized("scanner.status.idlePrompt"),
  )
  const [error, setError] = useState<LocalizedText | null>(() =>
    transferState.kind === "error"
      ? localizedErrorCode(transferState.code)
      : null,
  )
  const localizedError =
    error === null ? null : t(error.key, error.values)
  const [frameSetComplete, setFrameSetComplete] = useState(
    transferState.kind === "complete",
  )

  useLayoutEffect(() => {
    readinessRef.current = readiness
  }, [readiness])

  useEffect(() => {
    cameraAvailableRef.current = cameraAvailable
  }, [cameraAvailable])
  useEffect(() => {
    multipartRef.current = multipart
  }, [multipart])

  const publishCameraMode = useCallback((mode: ScannerMode) => {
    cameraModeRef.current = mode
    if (mountedRef.current) setCameraMode(mode)
  }, [])

  const publishTransferState = useCallback((next: TransferState) => {
    previousTransferKindRef.current = next.kind
    if (mountedRef.current) setTransferState(next)
  }, [])

  const cancelRun = useCallback(
    (run: ScannerRun, nextCameraState: CameraScanState) => {
      run.cancelled = true
      run.abortController.abort()
      run.handle?.stop()
      run.handle = null
      if (activeRunRef.current === run) {
        activeRunRef.current = null
        startLockedRef.current = false
        cameraStateRef.current = nextCameraState
      }
    },
    [],
  )

  // The session hands the claim back itself when delivery rejects, so this runs
  // purely as the publish step for a run that may already be unmounted.
  const settleDelivery = useCallback(
    (run: ScannerRun, succeeded: boolean, caught: unknown) => {
      if (
        !mountedRef.current ||
        nextRunIdRef.current !== run.id
      ) {
        return
      }
      publishCameraMode("idle")
      if (succeeded) {
        setError(null)
        setCameraStatus(localized("scanner.status.allFramesRead"))
        return
      }
      setError(localizedErrorCode(deliveryError(caught).code))
      setCameraStatus(localized("scanner.status.deliverFailed"))
    },
    [publishCameraMode],
  )

  const startCamera = useCallback(() => {
    if (
      startLockedRef.current ||
      cameraModeRef.current === "running" ||
      cameraModeRef.current === "delivering" ||
      readinessRef.current !== "ready" ||
      !cameraAvailableRef.current
    ) {
      return
    }

    const runId = ++nextRunIdRef.current
    const configuration = multipartRef.current
    const session = configuration.session
    const sessionState = session.state()
    if (sessionState.kind === "error") {
      publishTransferState(sessionState)
      setError(localizedErrorCode(sessionState.code))
      return
    }

    const run: ScannerRun = {
      id: runId,
      abortController: new AbortController(),
      handle: null,
      session,
      cancelled: false,
      errorReported: false,
      emitted: false,
    }

    const stopAsAlreadyRead = () => {
      run.emitted = true
      cancelRun(run, "idle")
      publishCameraMode("idle")
      setCameraStatus(localized("scanner.status.allFramesRead"))
    }

    const deliver = (
      completed: Extract<TransferState, { kind: "complete" }>,
    ) => {
      // The status switch sits inside the delivery so it never runs for a
      // completion another surface already owns.
      const pending = run.session.deliverOnce(() => {
        run.emitted = true
        cancelRun(run, "idle")
        publishCameraMode("delivering")
        setError(null)
        setCameraStatus(localized("scanner.status.delivering"))
        return multipartRef.current.onComplete({
          artifactType: completed.artifactType,
          artifactBytes: completed.artifactBytes,
        })
      })
      if (pending === null) {
        stopAsAlreadyRead()
        return
      }
      void pending.then(
        () => settleDelivery(run, true, undefined),
        (caught: unknown) => settleDelivery(run, false, caught),
      )
    }

    if (sessionState.kind === "complete") {
      activeRunRef.current = run
      startLockedRef.current = true
      publishTransferState(sessionState)
      setFrameSetComplete(true)
      deliver(sessionState)
      return
    }

    const video = videoRef.current
    if (video === null) {
      cameraStateRef.current = "failed"
      publishCameraMode("stopped")
      setError(localized("scanner.error.videoNotReady"))
      setCameraStatus(localized("scanner.status.videoNotReady"))
      return
    }

    activeRunRef.current = run
    startLockedRef.current = true
    cameraStateRef.current = "acquiring"
    publishCameraMode("running")
    setError(null)
    setCameraStatus(localized("scanner.status.preparing"))

    const onText = (payload: string) => {
      if (
        run.cancelled ||
        run.emitted ||
        activeRunRef.current !== run
      ) {
        return
      }

      if (!payload.startsWith(QR_PREFIX_V2.frame)) {
        setError(
          localized("scanner.mismatch", {
            actual: t("scanner.payloadLabel.foreign"),
            accepted: t("scanner.acceptedLabel.multipart"),
          }),
        )
        setCameraStatus(localized("scanner.status.unacceptedRejected"))
        return
      }

      setError(null)
      setFrameSetComplete(false)
      setCameraStatus(localized("scanner.status.multipartReading"))
      void run.session
        .add(payload)
        .then((next) => {
          if (run.cancelled || activeRunRef.current !== run) return
          publishTransferState(next)
          if (next.kind === "error") {
            setError(localizedErrorCode(next.code))
            setCameraStatus(localized("scanner.status.multipartError"))
            return
          }
          if (next.kind === "idle") {
            cancelRun(run, "idle")
            publishCameraMode("idle")
            setError(localized("scanner.error.expiredDiscarded"))
            setCameraStatus(localized("scanner.status.stateDiscarded"))
            return
          }
          if (next.kind === "collecting") {
            setCameraStatus(localized("scanner.status.multipartReadingUnordered"))
            return
          }
          setFrameSetComplete(true)
          deliver(next)
        })
        .catch((caught: unknown) => {
          if (run.cancelled || activeRunRef.current !== run) return
          setError(localizedErrorCode(deliveryError(caught).code))
          setCameraStatus(localized("scanner.status.multipartError"))
        })
    }

    const onCameraError = (
      scanError: AppError,
      failedState: CameraFailureState,
    ) => {
      if (run.cancelled || activeRunRef.current !== run) return
      run.errorReported = true
      cancelRun(run, failedState)
      publishCameraMode("stopped")
      setError(localizedErrorCode(scanError.code))
      setCameraStatus(localized("scanner.status.cameraError"))
    }

    let startPromise: Promise<QrScanHandle>
    try {
      // The acquisition queue in decode.ts can delay getUserMedia, so the UI layer cannot
      // guarantee strict user activation timing.
      startPromise = startQrScan(video, onText, onCameraError, {
        once: false,
        signal: run.abortController.signal,
      })
    } catch (caught) {
      const appError = deliveryError(caught)
      run.errorReported = true
      cancelRun(run, "failed")
      publishCameraMode("stopped")
      setError(localizedErrorCode(appError.code))
      setCameraStatus(localized("scanner.status.startFailed"))
      return
    }

    void startPromise
      .then((handle) => {
        if (
          run.cancelled ||
          run.errorReported ||
          run.emitted ||
          activeRunRef.current !== run
        ) {
          handle.stop()
          return
        }
        run.handle = handle
        cameraStateRef.current = "playing"
        setCameraStatus(localized("scanner.status.readUnordered"))
      })
      .catch((caught: unknown) => {
        if (
          run.cancelled ||
          run.errorReported ||
          activeRunRef.current !== run
        ) {
          return
        }
        const appError =
          caught instanceof AppError
            ? caught
            : new AppError("CAMERA_NOT_AVAILABLE")
        cancelRun(run, "failed")
        publishCameraMode("stopped")
        setError(localizedErrorCode(appError.code))
        setCameraStatus(localized("scanner.status.startFailed"))
      })
  }, [
    cancelRun,
    publishCameraMode,
    publishTransferState,
    settleDelivery,
    t,
  ])

  const discardTransfer = useCallback(() => {
    nextRunIdRef.current += 1
    multipartRef.current.session.discard()
    const run = activeRunRef.current
    if (run !== null) cancelRun(run, "idle")
    publishTransferState(IDLE_TRANSFER_STATE)
    publishCameraMode("idle")
    setFrameSetComplete(false)
    setError(null)
    setCameraStatus(localized("scanner.status.discardedCanStart"))
  }, [cancelRun, publishCameraMode, publishTransferState])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const run = activeRunRef.current
      if (run !== null) cancelRun(run, "idle")
      cameraModeRef.current = "idle"
    }
  }, [cancelRun])

  useEffect(() => {
    if (autoStart && readyAtMountRef.current) startCamera()
  }, [autoStart, startCamera])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const run = activeRunRef.current
        if (run === null) return
        cancelRun(run, "track-ended")
        publishCameraMode("stopped")
        setError(localized("scanner.error.hiddenStopped"))
        setCameraStatus(localized("scanner.status.leftScreenStopped"))
        return
      }

      const shouldShowStopped = shouldRestartQrScanOnVisibility(
        cameraStateRef.current,
        document.visibilityState,
      )
      if (shouldShowStopped) publishCameraMode("stopped")
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [cancelRun, publishCameraMode])

  useEffect(() => {
    if (cameraAvailable || activeRunRef.current === null) return
    cancelRun(activeRunRef.current, "failed")
    publishCameraMode("stopped")
    setError(localized("scanner.error.cameraUnavailable"))
    setCameraStatus(localized("scanner.status.cameraUnavailable"))
  }, [cameraAvailable, cancelRun, publishCameraMode])

  const previousSessionRef = useRef(multipartSession)
  useEffect(() => {
    if (previousSessionRef.current === multipartSession) return
    previousSessionRef.current = multipartSession
    const run = activeRunRef.current
    if (run !== null) cancelRun(run, "idle")
    const next = multipartSession.state()
    nextRunIdRef.current += 1
    publishTransferState(next)
    publishCameraMode("idle")
    setFrameSetComplete(next.kind === "complete")
    setError(
      next.kind === "error" ? localizedErrorCode(next.code) : null,
    )
    setCameraStatus(localized("scanner.status.idlePrompt"))
  }, [
    cancelRun,
    multipartSession,
    publishCameraMode,
    publishTransferState,
  ])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const previousKind = previousTransferKindRef.current
      const next = multipartSession.state()
      previousTransferKindRef.current = next.kind
      if (!mountedRef.current) return
      // state() rebuilds its result on every call, so publishing it unconditionally
      // re-renders the panel once a second for its whole mounted life. Frame progress
      // is published by onText as it arrives; this poller exists only to notice a
      // kind change it did not cause — an expiry or a discard from another surface.
      if (next.kind === previousKind) return
      setTransferState(next)
      if (next.kind === "error") setError(localizedErrorCode(next.code))
      if (previousKind === "idle" || next.kind !== "idle") return

      nextRunIdRef.current += 1
      const run = activeRunRef.current
      if (run !== null) cancelRun(run, "idle")
      publishCameraMode("idle")
      setFrameSetComplete(false)
      setError(
        previousKind === "collecting"
          ? localized("scanner.error.expiredDiscarded")
          : localized("scanner.error.stateDiscardedGeneric"),
      )
      setCameraStatus(localized("scanner.status.stateDiscarded"))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [
    cancelRun,
    multipartSession,
    publishCameraMode,
  ])

  const collecting =
    transferState.kind === "collecting" ? transferState : null
  const received = collecting?.receivedIndexes.size ?? 0
  const frameCount = collecting?.frameCount ?? 0
  const restartBlocked = transferState.kind === "error"
  const announcedStatus = (() => {
    switch (readiness) {
      case "preparing":
        return t("scanner.status.readerLoading")
      case "blocked":
        return t("errors.QR_READER_BLOCKED")
      case "failed":
        return t("scanner.reader.reloadHint")
      case "ready":
        return t(cameraStatus.key, cameraStatus.values)
    }
  })()

  return (
    <Card aria-busy={cameraMode === "running" || cameraMode === "delivering"}>
      <CardHeader className="p-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera aria-hidden="true" className="size-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {resolvedStopHint}
        </p>

        <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-950">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label={t("scanner.video.ariaLabel")}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-[12%] rounded-xl border-2 border-white">
            <ScanLine
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-white"
            />
          </div>
          {cameraMode !== "running" && cameraMode !== "delivering" && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/65 p-4">
              {readiness === "failed" || readiness === "blocked" ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <p className="text-sm text-white">
                    {t(
                      readiness === "blocked"
                        ? "errors.QR_READER_BLOCKED"
                        : "scanner.reader.reloadHint",
                    )}
                  </p>
                  {readiness === "failed" && (
                    <Button
                      type="button"
                      className="h-11 cursor-pointer focus-visible:ring-2"
                      onClick={reloadApplication}
                    >
                      <RefreshCw aria-hidden="true" />
                      {t("scanner.button.reload")}
                    </Button>
                  )}
                </div>
              ) : (
                <Button
                  type="button"
                  className="h-11 cursor-pointer focus-visible:ring-2"
                  disabled={
                    !cameraAvailable ||
                    restartBlocked ||
                    readiness !== "ready"
                  }
                  onClick={startCamera}
                >
                  {cameraMode === "stopped" ? (
                    <RefreshCw aria-hidden="true" />
                  ) : (
                    <Camera aria-hidden="true" />
                  )}
                  {cameraMode === "stopped"
                    ? t("scanner.button.restart")
                    : t("scanner.button.start")}
                </Button>
              )}
            </div>
          )}
        </div>

        {!cameraAvailable && (
          <p className="text-sm text-muted-foreground">
            {t("scanner.error.cameraUnavailable")}
          </p>
        )}

        <p
          role="status"
          aria-live="polite"
          className="text-center text-sm text-muted-foreground"
        >
          {announcedStatus}
        </p>

        {collecting && (
          <div
            className="space-y-2"
            aria-label={t("scanner.progress.ariaLabel")}
          >
            <div className="flex justify-between font-mono text-sm tabular-nums">
              <span>
                {t("scanner.progress.received", {
                  received,
                  total: frameCount,
                })}
              </span>
              <span>{Math.round((received / frameCount) * 100)}%</span>
            </div>
            <Progress value={(received / frameCount) * 100} />
            <p className="text-xs text-muted-foreground">
              {t("scanner.progress.missingIndex", {
                indexes: formatFramePositions(
                  collecting.missingIndexes,
                  language,
                ),
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("scanner.progress.expiresAt", {
                time: new Date(collecting.expiresAt).toLocaleTimeString(
                  language === "ja" ? "ja-JP" : "en-US",
                ),
              })}
            </p>
          </div>
        )}

        {frameSetComplete && (
          <p role="status" className="text-sm text-success">
            {t("scanner.frameSetComplete")}
          </p>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("scanner.frameSetNotice")}
        </p>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("scanner.error.title")}</AlertTitle>
            <AlertDescription>{localizedError}</AlertDescription>
          </Alert>
        )}

        <Button
          type="button"
          variant="destructive"
          className="h-11 w-full cursor-pointer focus-visible:ring-2"
          disabled={cameraMode === "delivering"}
          onClick={discardTransfer}
        >
          <Trash2 aria-hidden="true" />
          {t("scanner.button.discard")}
        </Button>
      </CardContent>
    </Card>
  )
}
