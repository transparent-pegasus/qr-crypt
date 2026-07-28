import { useCallback, useEffect, useRef, useState } from "react"
import {
  Camera,
  CameraOff,
  RefreshCw,
  ScanLine,
  Trash2,
} from "lucide-react"
import { AppError } from "@/crypto/errors"
import type { MultipartScanSession } from "@/features/multipart-scan-session"
import { formatFramePositions } from "@/features/presentation"
import { useQrReaderReadiness } from "@/hooks/use-qr-reader-readiness"
import {
  startQrScan,
  type CameraDiagnostic,
  type CameraPipelineDiagnostic,
  type CameraScanState,
  type QrScanHandle,
} from "@/qr/decode"
import type { TransferState } from "@/qr/multipart/transfer-state"
import {
  acceptedPayloadLabel,
  actualPayloadLabel,
  deliveryError,
  localized,
  localizedErrorCode,
  targetForPayload,
  type LocalizedText,
  type QrScannerPanelProps,
  type ScannerTarget,
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
  session: MultipartScanSession | undefined
  cancelled: boolean
  errorReported: boolean
  emitted: boolean
  multipartLocked: boolean
}

const IDLE_TRANSFER_STATE: TransferState = { kind: "idle" }

export function QrScannerPanel(props: QrScannerPanelProps) {
  const { language, t } = useI18n()
  const readiness = useQrReaderReadiness()
  const readyAtMountRef = useRef(readiness === "ready")
  const {
    singleTargets,
    onSingleScan,
    cameraAvailable = true,
    title: titleProp,
    autoStart = false,
    stopHint: stopHintProp,
  } = props
  const title = titleProp ?? t("scanner.defaultTitle")
  const stopHint = stopHintProp ?? t("scanner.stopHint.default")
  const multipart = props.multipart
  const multipartSession = multipart?.session
  const resolvedStopHint =
    multipart === undefined ? stopHint : t("scanner.stopHint.multipart")

  const videoRef = useRef<HTMLVideoElement>(null)
  const mountedRef = useRef(true)
  const cameraAvailableRef = useRef(cameraAvailable)
  const singleTargetsRef = useRef(singleTargets)
  const onSingleScanRef = useRef(onSingleScan)
  const multipartRef = useRef(multipart)
  const activeRunRef = useRef<ScannerRun | null>(null)
  const nextRunIdRef = useRef(0)
  const startLockedRef = useRef(false)
  const cameraModeRef = useRef<ScannerMode>("idle")
  const cameraStateRef = useRef<CameraScanState>("idle")
  const [transferState, setTransferState] = useState<TransferState>(
    () => multipartSession?.state() ?? IDLE_TRANSFER_STATE,
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
  const [diagnostic, setDiagnostic] = useState<CameraDiagnostic | null>(null)
  const [pipelineDiagnostic, setPipelineDiagnostic] =
    useState<CameraPipelineDiagnostic | null>(null)
  const [integrityConfirmed, setIntegrityConfirmed] = useState(
    transferState.kind === "complete",
  )

  useEffect(() => {
    cameraAvailableRef.current = cameraAvailable
  }, [cameraAvailable])
  useEffect(() => {
    singleTargetsRef.current = singleTargets
  }, [singleTargets])
  useEffect(() => {
    onSingleScanRef.current = onSingleScan
  }, [onSingleScan])
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

  const settleDelivery = useCallback(
    (
      run: ScannerRun,
      succeeded: boolean,
      caught: unknown,
      successStatus: LocalizedText,
    ) => {
      if (
        !mountedRef.current ||
        nextRunIdRef.current !== run.id
      ) {
        return
      }
      publishCameraMode("idle")
      if (succeeded) {
        setError(null)
        setCameraStatus(successStatus)
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
      !cameraAvailableRef.current
    ) {
      return
    }

    const runId = ++nextRunIdRef.current
    const configuration = multipartRef.current
    const session = configuration?.session
    const sessionState = session?.state() ?? IDLE_TRANSFER_STATE
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
      multipartLocked: sessionState.kind === "collecting",
    }

    const deliver = (
      operation: () => void | Promise<void>,
      successStatus: LocalizedText,
    ) => {
      run.emitted = true
      cancelRun(run, "idle")
      publishCameraMode("delivering")
      setError(null)
      setDiagnostic(null)
      setPipelineDiagnostic(null)
      setCameraStatus(localized("scanner.status.delivering"))
      void (async () => {
        try {
          await operation()
          settleDelivery(run, true, undefined, successStatus)
        } catch (caught) {
          settleDelivery(run, false, caught, successStatus)
        }
      })()
    }

    if (sessionState.kind === "complete") {
      activeRunRef.current = run
      startLockedRef.current = true
      publishTransferState(sessionState)
      setIntegrityConfirmed(true)
      if (!session?.claimCompletion()) {
        run.emitted = true
        cancelRun(run, "idle")
        publishCameraMode("idle")
        setCameraStatus(localized("scanner.status.allFramesRead"))
        return
      }
      deliver(
        () =>
          multipartRef.current?.onComplete({
            artifactType: sessionState.artifactType,
            artifactBytes: sessionState.artifactBytes,
          }),
        localized("scanner.status.allFramesRead"),
      )
      return
    }

    const video = videoRef.current
    if (video === null) {
      cameraStateRef.current = "failed"
      publishCameraMode("stopped")
      setError(localized("scanner.error.videoNotReady"))
      setDiagnostic(null)
      setPipelineDiagnostic(null)
      setCameraStatus(localized("scanner.status.videoNotReady"))
      return
    }

    activeRunRef.current = run
    startLockedRef.current = true
    cameraStateRef.current = "acquiring"
    publishCameraMode("running")
    setError(null)
    setDiagnostic(null)
    setPipelineDiagnostic(null)
    setCameraStatus(localized("scanner.status.preparing"))

    const finishSingleScan = (target: ScannerTarget, payload: string) => {
      if (
        run.cancelled ||
        run.emitted ||
        activeRunRef.current !== run
      ) {
        return
      }
      deliver(
        () => onSingleScanRef.current(target, payload),
        localized("scanner.status.qrRead"),
      )
    }

    const finishMultipartScan = (
      currentSession: MultipartScanSession,
      next: Extract<TransferState, { kind: "complete" }>,
    ) => {
      const claimed = currentSession.claimCompletion()
      setIntegrityConfirmed(true)
      if (!claimed) {
        run.emitted = true
        cancelRun(run, "idle")
        publishCameraMode("idle")
        setCameraStatus(localized("scanner.status.allFramesRead"))
        return
      }
      deliver(
        () =>
          multipartRef.current?.onComplete({
            artifactType: next.artifactType,
            artifactBytes: next.artifactBytes,
          }),
        localized("scanner.status.allFramesRead"),
      )
    }

    const onText = (payload: string) => {
      if (
        run.cancelled ||
        run.emitted ||
        activeRunRef.current !== run
      ) {
        return
      }

      if (payload.startsWith("OCF2:")) {
        if (run.session === undefined) {
          setError(localized("scanner.error.multipartNotAccepted"))
          setCameraStatus(localized("scanner.status.multipartRejected"))
          return
        }

        // Exclude races with single-payload delivery even before the add() promise settles.
        run.multipartLocked = true
        setError(null)
        setIntegrityConfirmed(false)
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
              run.multipartLocked = false
              cancelRun(run, "idle")
              publishCameraMode("idle")
              setError(localized("scanner.error.expiredDiscarded"))
              setCameraStatus(localized("scanner.status.stateDiscarded"))
              return
            }
            if (next.kind === "collecting") {
              setCameraStatus(
                localized("scanner.status.multipartReadingUnordered"),
              )
              return
            }
            finishMultipartScan(run.session!, next)
          })
          .catch((caught: unknown) => {
            if (run.cancelled || activeRunRef.current !== run) return
            setError(localizedErrorCode(deliveryError(caught).code))
            setCameraStatus(localized("scanner.status.multipartError"))
          })
        return
      }

      const target = targetForPayload(payload)
      if (target !== null && run.multipartLocked) {
        setError(localized("scanner.error.singleWhileMultipart"))
        setCameraStatus(
          localized("scanner.status.singleRejectedDuringMultipart"),
        )
        return
      }
      if (
        target === null ||
        !singleTargetsRef.current.includes(target)
      ) {
        setError(
          localized("scanner.mismatch", {
            actual: actualPayloadLabel(payload, t),
            accepted: acceptedPayloadLabel(
              singleTargetsRef.current,
              run.session !== undefined,
              t,
            ),
          }),
        )
        setCameraStatus(localized("scanner.status.unacceptedRejected"))
        return
      }

      finishSingleScan(target, payload)
    }

    const onCameraError = (
      scanError: AppError,
      cameraDiagnostic: CameraDiagnostic,
    ) => {
      if (run.cancelled || activeRunRef.current !== run) return
      run.errorReported = true
      const failedState: CameraScanState =
        cameraDiagnostic.phase === "track-ended" ? "track-ended" : "failed"
      cancelRun(run, failedState)
      publishCameraMode("stopped")
      setError(localizedErrorCode(scanError.code))
      setDiagnostic(
        scanError.code === "CAMERA_PERMISSION_DENIED" ||
          scanError.code === "CAMERA_NOT_AVAILABLE" ||
          scanError.code === "QR_DECODE_PROGRESS_TIMEOUT"
          ? cameraDiagnostic
          : null,
      )
      setCameraStatus(localized("scanner.status.cameraError"))
    }

    const onPipelineDiagnostic = (
      nextDiagnostic: CameraPipelineDiagnostic,
    ) => {
      if (run.cancelled || activeRunRef.current !== run) return
      setPipelineDiagnostic(nextDiagnostic)
    }

    let startPromise: Promise<QrScanHandle>
    try {
      // The acquisition queue in decode.ts can delay getUserMedia, so the UI layer cannot
      // guarantee strict user activation timing.
      startPromise = startQrScan(video, onText, onCameraError, {
        once: false,
        signal: run.abortController.signal,
        onDiagnostic: onPipelineDiagnostic,
      })
    } catch (caught) {
      const appError = deliveryError(caught)
      run.errorReported = true
      cancelRun(run, "failed")
      publishCameraMode("stopped")
      setError(localizedErrorCode(appError.code))
      setDiagnostic(null)
      setPipelineDiagnostic(null)
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
        setCameraStatus(
          run.session === undefined
            ? localized("scanner.status.alignInFrame")
            : localized("scanner.status.readUnordered"),
        )
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
        setDiagnostic(null)
        setPipelineDiagnostic(null)
        setCameraStatus(localized("scanner.status.startFailed"))
      })
  }, [
    cancelRun,
    publishCameraMode,
    publishTransferState,
    settleDelivery,
    t,
  ])

  const stopCamera = useCallback(() => {
    const run = activeRunRef.current
    if (run === null) return
    cancelRun(run, "idle")
    publishCameraMode("stopped")
    setError(localized("scanner.error.stopped"))
    setDiagnostic(null)
    setPipelineDiagnostic(null)
    setCameraStatus(localized("scanner.status.stopped"))
  }, [cancelRun, publishCameraMode])

  const discardTransfer = useCallback(() => {
    nextRunIdRef.current += 1
    const session = multipartRef.current?.session
    session?.discard()
    const run = activeRunRef.current
    if (run !== null) cancelRun(run, "idle")
    publishTransferState(IDLE_TRANSFER_STATE)
    publishCameraMode("idle")
    setIntegrityConfirmed(false)
    setError(null)
    setDiagnostic(null)
    setPipelineDiagnostic(null)
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
        setDiagnostic(null)
        setPipelineDiagnostic(null)
        setCameraStatus(localized("scanner.status.leftScreenStopped"))
        return
      }

      const shouldShowStopped =
        startQrScan.shouldRestartOnVisibility?.(
          cameraStateRef.current,
          document.visibilityState,
        ) ??
        (document.visibilityState === "visible" &&
          (cameraStateRef.current === "failed" ||
            cameraStateRef.current === "track-ended"))
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
    setDiagnostic(null)
    setPipelineDiagnostic(null)
    setCameraStatus(localized("scanner.status.cameraUnavailable"))
  }, [cameraAvailable, cancelRun, publishCameraMode])

  const previousSessionRef = useRef(multipartSession)
  useEffect(() => {
    if (previousSessionRef.current === multipartSession) return
    previousSessionRef.current = multipartSession
    const run = activeRunRef.current
    if (run !== null) cancelRun(run, "idle")
    const next = multipartSession?.state() ?? IDLE_TRANSFER_STATE
    nextRunIdRef.current += 1
    publishTransferState(next)
    publishCameraMode("idle")
    setIntegrityConfirmed(next.kind === "complete")
    setError(
      next.kind === "error" ? localizedErrorCode(next.code) : null,
    )
    setDiagnostic(null)
    setPipelineDiagnostic(null)
    setCameraStatus(localized("scanner.status.idlePrompt"))
  }, [
    cancelRun,
    multipartSession,
    publishCameraMode,
    publishTransferState,
  ])

  useEffect(() => {
    if (multipartSession === undefined) return
    const timer = window.setInterval(() => {
      const previousKind = previousTransferKindRef.current
      const next = multipartSession.state()
      previousTransferKindRef.current = next.kind
      if (!mountedRef.current) return
      setTransferState(next)
      if (next.kind === "error") setError(localizedErrorCode(next.code))
      if (previousKind === "idle" || next.kind !== "idle") return

      nextRunIdRef.current += 1
      const run = activeRunRef.current
      if (run !== null) cancelRun(run, "idle")
      publishCameraMode("idle")
      setIntegrityConfirmed(false)
      setDiagnostic(null)
      setPipelineDiagnostic(null)
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
                      onClick={() => window.location.reload()}
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
          aria-live="polite"
          className="text-center text-sm text-muted-foreground"
        >
          {readiness === "preparing"
            ? t("scanner.status.readerLoading")
            : t(cameraStatus.key, cameraStatus.values)}
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

        {integrityConfirmed && (
          <p role="status" className="text-sm text-success">
            {t("scanner.integrityConfirmed")}
          </p>
        )}

        {multipart !== undefined && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("scanner.sha256Notice")}
          </p>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t("scanner.error.title")}</AlertTitle>
            <AlertDescription>{localizedError}</AlertDescription>
          </Alert>
        )}
        {diagnostic && (
          <p
            aria-label={t("scanner.diagnostic.ariaLabel")}
            className="font-mono text-xs text-muted-foreground"
          >
            {t("scanner.diagnostic", {
              name: diagnostic.name ?? "unknown",
              phase: diagnostic.phase,
              detail: diagnostic.detail,
            })}
          </p>
        )}
        {pipelineDiagnostic && (
          <p
            aria-label={t("scanner.pipelineDiagnostic.ariaLabel")}
            className="font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {t("scanner.pipelineDiagnostic", {
              moduleState: pipelineDiagnostic.readerModuleState,
              frames: pipelineDiagnostic.videoFramesDrawn,
              attempts: pipelineDiagnostic.decodeAttemptsCompleted,
              results: pipelineDiagnostic.decodeResultsSeen,
              lastError:
                pipelineDiagnostic.lastErrorName ??
                t("scanner.pipelineDiagnostic.noError"),
            })}
          </p>
        )}

        {multipart !== undefined ? (
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
        ) : (
          cameraMode === "running" && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full cursor-pointer focus-visible:ring-2"
              onClick={stopCamera}
            >
              <CameraOff aria-hidden="true" />
              {t("scanner.button.stopCamera")}
            </Button>
          )
        )}
      </CardContent>
    </Card>
  )
}
