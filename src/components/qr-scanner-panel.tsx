import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, CameraOff, RefreshCw, ScanLine, Trash2 } from "lucide-react"
import { AppError, userMessageFor } from "@/crypto/errors"
import type { MultipartScanSession } from "@/features/multipart-scan-session"
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
import { Progress } from "@/components/ui/progress"

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

type ScannerMode = "idle" | "running" | "stopped"

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
  } = props
  const multipart = props.multipart
  const multipartSession = multipart?.session

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

  const showDeliveryError = useCallback(
    (caught: unknown, expectedRunId: number) => {
      if (
        !mountedRef.current ||
        nextRunIdRef.current !== expectedRunId
      ) {
        return
      }
      setError(deliveryError(caught).userMessage)
    },
    [],
  )

  const startCamera = useCallback(() => {
    if (
      startLockedRef.current ||
      cameraModeRef.current === "running" ||
      !cameraAvailableRef.current
    ) {
      return
    }

    const runId = ++nextRunIdRef.current
    const video = videoRef.current
    if (video === null) {
      cameraStateRef.current = "failed"
      publishCameraMode("stopped")
      setError("カメラ画面を準備できませんでした。ページを開き直してください。")
      setDiagnostic(null)
      setCameraStatus("カメラ画面を準備できませんでした")
      return
    }

    const configuration = multipartRef.current
    const session = configuration?.session
    let sessionState = session?.state() ?? IDLE_TRANSFER_STATE
    if (sessionState.kind === "error") {
      publishTransferState(sessionState)
      setError(userMessageFor(sessionState.code))
      return
    }
    if (sessionState.kind === "complete") {
      session?.discard()
      sessionState = IDLE_TRANSFER_STATE
      publishTransferState(sessionState)
      setIntegrityConfirmed(false)
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
      run.emitted = true
      cancelRun(run, "idle")
      publishCameraMode("idle")
      setError(null)
      setDiagnostic(null)
      setCameraStatus("QRコードを読み取りました")
      try {
        const result = onSingleScanRef.current(target, payload)
        void Promise.resolve(result).catch((caught: unknown) =>
          showDeliveryError(caught, run.id),
        )
      } catch (caught) {
        showDeliveryError(caught, run.id)
      }
    }

    const finishMultipartScan = (
      currentSession: MultipartScanSession,
      next: Extract<TransferState, { kind: "complete" }>,
    ) => {
      const claimed = currentSession.claimCompletion()
      run.emitted = true
      cancelRun(run, "idle")
      publishCameraMode("idle")
      setIntegrityConfirmed(true)
      setCameraStatus("全フレームを読み取りました")
      if (!claimed) return
      try {
        const result = multipartRef.current?.onComplete({
          artifactType: next.artifactType,
          artifactBytes: next.artifactBytes,
        })
        void Promise.resolve(result).catch((caught: unknown) =>
          showDeliveryError(caught, run.id),
        )
      } catch (caught) {
        showDeliveryError(caught, run.id)
      }
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
    showDeliveryError,
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
    }
  }, [cancelRun])

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
    <Card aria-busy={cameraMode === "running"}>
      <CardHeader className="p-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera aria-hidden="true" className="size-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <p className="text-xs leading-relaxed text-muted-foreground">
          カメラ画像は保存されません。停止ボタンまたは画面離脱で停止します。
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
          {cameraMode !== "running" && (
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
              欠損 index: {collecting.missingIndexes.join(", ") || "なし"}
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

        {(cameraMode === "running" || multipart !== undefined) && (
          <div className="grid grid-cols-2 gap-2">
            {cameraMode === "running" && (
              <Button
                type="button"
                variant="outline"
                className="col-span-1 h-11 cursor-pointer focus-visible:ring-2"
                onClick={stopCamera}
              >
                <CameraOff aria-hidden="true" />
                カメラを停止
              </Button>
            )}
            {multipart !== undefined && (
              <Button
                type="button"
                variant="destructive"
                className={`${cameraMode === "running" ? "col-span-1" : "col-span-2"} h-11 cursor-pointer focus-visible:ring-2`}
                onClick={discardTransfer}
              >
                <Trash2 aria-hidden="true" />
                読取状態を破棄
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
