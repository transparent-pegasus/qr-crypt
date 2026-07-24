import { useCallback, useEffect, useRef, useState } from "react"
import {
  Camera,
  CameraOff,
  RefreshCw,
  ScanLine,
  Trash2,
} from "lucide-react"
import { AppError, userMessageFor } from "@/crypto/errors"
import type { MultipartScanSession } from "@/features/multipart-scan-session"
import { formatFramePositions } from "@/features/presentation"
import {
  startQrScan,
  type CameraDiagnostic,
  type CameraScanState,
  type QrScanHandle,
} from "@/qr/decode"
import type { TransferState } from "@/qr/multipart/transfer-state"
import type { V2ArtifactType } from "@/schemas/domain"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

export type ScannerTarget = "message" | "symmetric-key" | "public-key"

const TARGET_PREFIX: Record<ScannerTarget, string> = {
  message: "OCM1:",
  "symmetric-key": "OCK1:",
  "public-key": "OCP1:",
}

const TARGET_LABEL: Record<ScannerTarget, string> = {
  message: "暗号文",
  "symmetric-key": "共通鍵",
  "public-key": "公開鍵",
}

export interface MultipartScanCompletion {
  artifactType: V2ArtifactType
  artifactBytes: Uint8Array
}

interface QrScannerPanelBaseProps {
  singleTargets: ScannerTarget[]
  onSingleScan: (
    target: ScannerTarget,
    payload: string,
  ) => void | Promise<void>
  cameraAvailable?: boolean
  title?: string
  autoStart?: boolean
  stopHint?: string
}

type QrScannerPanelMultipartProps =
  | {
      multipart: {
        session: MultipartScanSession
        onComplete: (
          completion: MultipartScanCompletion,
        ) => void | Promise<void>
      }
    }
  | { multipart?: never }

export type QrScannerPanelProps = QrScannerPanelBaseProps &
  QrScannerPanelMultipartProps

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
const DEFAULT_STOP_HINT =
  "カメラ画像は保存されません。停止ボタンまたは画面離脱で停止します。"
const MODAL_STOP_HINT =
  "カメラ画像は保存されません。閉じる・停止ボタン・画面離脱で停止します。"
const MULTIPART_STOP_HINT =
  "カメラ画像は保存されません。閉じる・破棄ボタン・画面離脱で停止します。"

function targetForPayload(payload: string): ScannerTarget | null {
  for (const target of Object.keys(TARGET_PREFIX) as ScannerTarget[]) {
    if (payload.startsWith(TARGET_PREFIX[target])) return target
  }
  return null
}

function actualPayloadLabel(payload: string): string {
  const target = targetForPayload(payload)
  return target === null ? "本アプリ以外" : TARGET_LABEL[target]
}

function acceptedPayloadLabel(
  singleTargets: ScannerTarget[],
  acceptsMultipart: boolean,
): string {
  const labels = singleTargets.map((target) => TARGET_LABEL[target])
  if (acceptsMultipart) labels.push("複数QR")
  return labels.join("・") || "設定されたQR"
}

function mismatchMessage(
  payload: string,
  singleTargets: ScannerTarget[],
  acceptsMultipart: boolean,
): string {
  return `受理対象外のQRです(${actualPayloadLabel(payload)})。この画面では${acceptedPayloadLabel(singleTargets, acceptsMultipart)}を読み取れます。`
}

function deliveryError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError("INVALID_QR_PAYLOAD")
}

export function QrScannerPanel(props: QrScannerPanelProps) {
  const {
    singleTargets,
    onSingleScan,
    cameraAvailable = true,
    title = "QRコードを読み取る",
    autoStart = false,
    stopHint = DEFAULT_STOP_HINT,
  } = props
  const multipart = props.multipart
  const multipartSession = multipart?.session
  const resolvedStopHint =
    multipart === undefined ? stopHint : MULTIPART_STOP_HINT

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
  const [cameraStatus, setCameraStatus] = useState(
    "起動ボタンを押すとカメラを開始します",
  )
  const [error, setError] = useState<string | null>(() =>
    transferState.kind === "error"
      ? userMessageFor(transferState.code)
      : null,
  )
  const [diagnostic, setDiagnostic] = useState<CameraDiagnostic | null>(null)
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
      successStatus: string,
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
      setError(deliveryError(caught).userMessage)
      setCameraStatus("取り込みを完了できませんでした")
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
      setError(userMessageFor(sessionState.code))
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
      successStatus: string,
    ) => {
      run.emitted = true
      cancelRun(run, "idle")
      publishCameraMode("delivering")
      setError(null)
      setDiagnostic(null)
      setCameraStatus("取り込み中です…")
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
        setCameraStatus("全フレームを読み取りました")
        return
      }
      deliver(
        () =>
          multipartRef.current?.onComplete({
            artifactType: sessionState.artifactType,
            artifactBytes: sessionState.artifactBytes,
          }),
        "全フレームを読み取りました",
      )
      return
    }

    const video = videoRef.current
    if (video === null) {
      cameraStateRef.current = "failed"
      publishCameraMode("stopped")
      setError("カメラ画面を準備できませんでした。ページを開き直してください。")
      setDiagnostic(null)
      setCameraStatus("カメラ画面を準備できませんでした")
      return
    }

    activeRunRef.current = run
    startLockedRef.current = true
    cameraStateRef.current = "acquiring"
    publishCameraMode("running")
    setError(null)
    setDiagnostic(null)
    setCameraStatus("カメラを準備しています…")

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
        "QRコードを読み取りました",
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
        setCameraStatus("全フレームを読み取りました")
        return
      }
      deliver(
        () =>
          multipartRef.current?.onComplete({
            artifactType: next.artifactType,
            artifactBytes: next.artifactBytes,
          }),
        "全フレームを読み取りました",
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
          setError("この画面では複数QRを受理しません。")
          setCameraStatus("複数QRを拒否しました")
          return
        }

        // add() の Promise が settle する前から単発配送との競合を閉じる。
        run.multipartLocked = true
        setError(null)
        setIntegrityConfirmed(false)
        setCameraStatus("複数QRを読み取り中です")
        void run.session
          .add(payload)
          .then((next) => {
            if (run.cancelled || activeRunRef.current !== run) return
            publishTransferState(next)
            if (next.kind === "error") {
              setError(userMessageFor(next.code))
              setCameraStatus("複数QRの読取状態にエラーがあります")
              return
            }
            if (next.kind === "idle") {
              run.multipartLocked = false
              cancelRun(run, "idle")
              publishCameraMode("idle")
              setError("読取期限を過ぎたため、一時読取状態を破棄しました。")
              setCameraStatus("読取状態を破棄しました")
              return
            }
            if (next.kind === "collecting") {
              setCameraStatus("複数QRを順不同で読み取り中です")
              return
            }
            finishMultipartScan(run.session!, next)
          })
          .catch((caught: unknown) => {
            if (run.cancelled || activeRunRef.current !== run) return
            setError(deliveryError(caught).userMessage)
            setCameraStatus("複数QRの読取状態にエラーがあります")
          })
        return
      }

      const target = targetForPayload(payload)
      if (target !== null && run.multipartLocked) {
        setError(
          "複数QR読取中です。単発QRは読取完了または破棄後に。",
        )
        setCameraStatus("複数QR読取中の単発QRを拒否しました")
        return
      }
      if (
        target === null ||
        !singleTargetsRef.current.includes(target)
      ) {
        setError(
          mismatchMessage(
            payload,
            singleTargetsRef.current,
            run.session !== undefined,
          ),
        )
        setCameraStatus("受理対象外のQRを拒否しました")
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
      setError(scanError.userMessage)
      setDiagnostic(
        scanError.code === "CAMERA_PERMISSION_DENIED" ||
          scanError.code === "CAMERA_NOT_AVAILABLE"
          ? cameraDiagnostic
          : null,
      )
      setCameraStatus("カメラでエラーが発生しました")
    }

    let startPromise: Promise<QrScanHandle>
    try {
      // decode.ts の取得キューで getUserMedia が遅延し得るため、厳密な user activation までは UI 層で保証できない。
      startPromise = startQrScan(video, onText, onCameraError, {
        once: false,
        signal: run.abortController.signal,
      })
    } catch (caught) {
      const appError = deliveryError(caught)
      run.errorReported = true
      cancelRun(run, "failed")
      publishCameraMode("stopped")
      setError(appError.userMessage)
      setDiagnostic(null)
      setCameraStatus("カメラを起動できませんでした")
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
            ? "QRコードを枠内に合わせてください"
            : "QRコードを順不同で読み取れます",
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
        setError(appError.userMessage)
        setDiagnostic(null)
        setCameraStatus("カメラを起動できませんでした")
      })
  }, [
    cancelRun,
    publishCameraMode,
    publishTransferState,
    settleDelivery,
  ])

  const stopCamera = useCallback(() => {
    const run = activeRunRef.current
    if (run === null) return
    cancelRun(run, "idle")
    publishCameraMode("stopped")
    setError("カメラを停止しました。再起動ボタンで再開できます。")
    setDiagnostic(null)
    setCameraStatus("カメラを停止しました")
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
    setCameraStatus("読取状態を破棄しました。起動ボタンでカメラを開始できます")
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
    if (autoStart) startCamera()
  }, [autoStart, startCamera])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const run = activeRunRef.current
        if (run === null) return
        cancelRun(run, "track-ended")
        publishCameraMode("stopped")
        setError(
          "画面が非表示になったためカメラを停止しました。再起動ボタンで再開できます。",
        )
        setDiagnostic(null)
        setCameraStatus("画面離脱によりカメラを停止しました")
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
    setError(
      "この端末ではカメラを利用できません。ペイロードを貼り付けてください。",
    )
    setDiagnostic(null)
    setCameraStatus("カメラを利用できません")
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
    setError(next.kind === "error" ? userMessageFor(next.code) : null)
    setDiagnostic(null)
    setCameraStatus("起動ボタンを押すとカメラを開始します")
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
      if (next.kind === "error") setError(userMessageFor(next.code))
      if (previousKind === "idle" || next.kind !== "idle") return

      nextRunIdRef.current += 1
      const run = activeRunRef.current
      if (run !== null) cancelRun(run, "idle")
      publishCameraMode("idle")
      setIntegrityConfirmed(false)
      setDiagnostic(null)
      setError(
        previousKind === "collecting"
          ? "読取期限を過ぎたため、一時読取状態を破棄しました。"
          : "読取状態が破棄されました。",
      )
      setCameraStatus("読取状態を破棄しました")
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
            aria-label="QRコード読取用カメラ映像"
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
              <Button
                type="button"
                className="h-11 cursor-pointer focus-visible:ring-2"
                disabled={!cameraAvailable || restartBlocked}
                onClick={startCamera}
              >
                {cameraMode === "stopped" ? (
                  <RefreshCw aria-hidden="true" />
                ) : (
                  <Camera aria-hidden="true" />
                )}
                {cameraMode === "stopped"
                  ? "カメラを再起動"
                  : "カメラを起動"}
              </Button>
            </div>
          )}
        </div>

        {!cameraAvailable && (
          <p className="text-sm text-muted-foreground">
            この端末ではカメラを利用できません。ペイロードを貼り付けてください。
          </p>
        )}

        <p
          aria-live="polite"
          className="text-center text-sm text-muted-foreground"
        >
          {cameraStatus}
        </p>

        {collecting && (
          <div className="space-y-2" aria-label="複数QR読取進捗">
            <div className="flex justify-between font-mono text-sm tabular-nums">
              <span>
                受信 {received} / {frameCount}
              </span>
              <span>{Math.round((received / frameCount) * 100)}%</span>
            </div>
            <Progress value={(received / frameCount) * 100} />
            <p className="text-xs text-muted-foreground">
              未読取フレーム: {formatFramePositions(collecting.missingIndexes)}
            </p>
            <p className="text-xs text-muted-foreground">
              読取期限: {new Date(collecting.expiresAt).toLocaleTimeString("ja-JP")}
            </p>
          </div>
        )}

        {integrityConfirmed && (
          <p role="status" className="text-sm text-success">
            全フレームのSHA-256整合性を確認しました。
          </p>
        )}

        {multipart !== undefined && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            SHA-256は転送中の欠損・混在検出用であり、送信者の真正性を証明しません。
          </p>
        )}

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>読み取りを完了できません</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {diagnostic && (
          <p
            aria-label="カメラ診断"
            className="font-mono text-xs text-muted-foreground"
          >
            {`診断: ${diagnostic.name ?? "unknown"} @${diagnostic.phase} [${diagnostic.detail}]`}
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
            読取状態を破棄
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
              カメラを停止
            </Button>
          )
        )}
      </CardContent>
    </Card>
  )
}

export type QrScannerModalProps = QrScannerPanelProps & {
  triggerLabel: string
  className?: string
}

export function QrScannerModal(props: QrScannerModalProps) {
  const {
    triggerLabel,
    cameraAvailable = true,
    title = "QRコードを読み取る",
    stopHint = MODAL_STOP_HINT,
    className,
  } = props
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
  const [closedNotice, setClosedNotice] = useState<string | null>(null)

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
            `複数QR読取中: 受信 ${next.receivedIndexes.size} / ${next.frameCount}`,
          )
        }
        return
      }
      if (next.kind === "idle") {
        if (previousKind === "collecting" && canPublish()) {
          setClosedNotice(
            "読取期限を過ぎたため、一時読取状態を破棄しました。",
          )
        }
        return
      }
      if (next.kind === "error") {
        if (canPublish()) setClosedNotice(userMessageFor(next.code))
        return
      }
      if (!beginDelivery()) return
      try {
        if (!multipartSession.claimCompletion()) return
        await multipartRef.current?.onComplete({
          artifactType: next.artifactType,
          artifactBytes: next.artifactBytes,
        })
        if (canPublish()) {
          setClosedNotice(
            "複数QRの全フレームSHA-256整合性を確認し、取り込みました。",
          )
        }
      } catch (caught) {
        if (canPublish()) {
          setClosedNotice(deliveryError(caught).userMessage)
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
  }, [beginDelivery, endDelivery, multipartSession, open])

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
    successNotice?: string,
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
        setClosedNotice(deliveryError(caught).userMessage)
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
              "複数QRの全フレームSHA-256整合性を確認し、取り込みました。",
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
            disabled={!cameraAvailable || deliveryBusy}
          >
            <Camera aria-hidden="true" />
            {triggerLabel}
          </Button>
        </DialogTrigger>
        <DialogContent
          ref={contentRef}
          tabIndex={-1}
          className="max-h-[95dvh] max-w-lg p-4"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            contentRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (!automaticCloseRef.current) return
            event.preventDefault()
            automaticCloseRef.current = false
          }}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div
            data-qr-scanner-scroll-region
            className="max-h-[calc(95dvh-4rem)] overflow-y-auto"
          >
            {open && panel}
          </div>
        </DialogContent>
      </Dialog>
      {!cameraAvailable && (
        <p className="text-sm text-muted-foreground">
          この端末ではカメラを利用できません。ペイロードを貼り付けてください。
        </p>
      )}
      {closedNotice && (
        <p
          aria-live="polite"
          className="whitespace-pre-line text-sm text-muted-foreground"
        >
          {closedNotice}
        </p>
      )}
    </div>
  )
}
