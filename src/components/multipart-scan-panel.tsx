import { useEffect, useRef, useState } from "react"
import { Camera, RefreshCw, ScanLine, Trash2 } from "lucide-react"
import type { TransferState } from "@/qr/multipart/transfer-state"
import type { V2ArtifactType } from "@/schemas/domain"
import type { QrScanHandle } from "@/qr/decode"
import { startQrScan } from "@/qr/decode"
import { AppError, userMessageFor } from "@/crypto/errors"
import type { MultipartScanSession } from "@/features/multipart-scan-session"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

export interface MultipartScanCompletion {
  artifactType: V2ArtifactType
  artifactBytes: Uint8Array
}

export interface MultipartScanPanelProps {
  session: MultipartScanSession
  onComplete: (completion: MultipartScanCompletion) => void | Promise<void>
  cameraAvailable?: boolean
  title?: string
}

function currentState(session: MultipartScanSession): TransferState {
  return session.state()
}

export function MultipartScanPanel({
  session,
  onComplete,
  cameraAvailable = true,
  title = "複数QRを連続読み取り",
}: MultipartScanPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scanHandleRef = useRef<QrScanHandle | null>(null)
  const onCompleteRef = useRef(onComplete)
  const previousKindRef = useRef<TransferState["kind"]>(session.state().kind)
  const [state, setState] = useState<TransferState>(() => currentState(session))
  const [cameraGeneration, setCameraGeneration] = useState(0)
  const [cameraStatus, setCameraStatus] = useState("カメラを準備しています…")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = currentState(session)
      if (previousKindRef.current === "collecting" && next.kind === "idle") {
        setError("読取期限を過ぎたため、一時読取状態を破棄しました。")
      }
      previousKindRef.current = next.kind
      setState(next)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [session])

  useEffect(() => {
    const initialState = session.state()
    if (
      !cameraAvailable ||
      initialState.kind === "complete" ||
      initialState.kind === "error"
    ) {
      return
    }
    let cancelled = false
    const abortController = new AbortController()
    scanHandleRef.current?.stop()
    scanHandleRef.current = null

    const start = async () => {
      setCameraStatus("カメラを準備しています…")
      const video = videoRef.current
      if (video === null) return
      try {
        const handle = await startQrScan(
          video,
          (payload) => {
            if (cancelled) return
            void session.add(payload).then(async (next) => {
              if (cancelled) return
              previousKindRef.current = next.kind
              setState(next)
              if (next.kind === "error") {
                setError(userMessageFor(next.code))
                scanHandleRef.current?.stop()
                return
              }
              if (next.kind !== "complete" || !session.claimCompletion()) return
              scanHandleRef.current?.stop()
              setCameraStatus("全フレームを読み取りました")
              try {
                await onCompleteRef.current({
                  artifactType: next.artifactType,
                  artifactBytes: next.artifactBytes,
                })
              } catch (caught) {
                const appError =
                  caught instanceof AppError ? caught : new AppError("INVALID_QR_PAYLOAD")
                setError(appError.userMessage)
              }
            })
          },
          (scanError) => {
            if (cancelled) return
            setError(scanError.userMessage)
            setCameraStatus("カメラでエラーが発生しました")
          },
          { once: false, signal: abortController.signal },
        )
        if (cancelled) handle.stop()
        else {
          scanHandleRef.current = handle
          setCameraStatus("QRコードを順不同で読み取れます")
        }
      } catch (caught) {
        if (!cancelled) {
          const appError =
            caught instanceof AppError ? caught : new AppError("CAMERA_NOT_AVAILABLE")
          setError(appError.userMessage)
          setCameraStatus("カメラを起動できませんでした")
        }
      }
    }

    queueMicrotask(() => void start())
    return () => {
      cancelled = true
      abortController.abort()
      scanHandleRef.current?.stop()
      scanHandleRef.current = null
    }
  }, [cameraAvailable, cameraGeneration, session])

  const collecting = state.kind === "collecting" ? state : null
  const received = collecting?.receivedIndexes.size ?? 0
  const frameCount = collecting?.frameCount ?? 0
  const expiresAt = collecting?.expiresAt

  return (
    <Card aria-busy={false}>
      <CardHeader className="p-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera aria-hidden="true" className="size-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {cameraAvailable ? (
          <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-950">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="複数QR読取用カメラ映像"
              className="h-full w-full object-cover"
            />
            <ScanLine
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-white"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            この端末ではカメラを利用できません。OCM2/OCI2ペイロードを貼り付けてください。
          </p>
        )}

        <p aria-live="polite" className="text-sm text-muted-foreground">
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
            {expiresAt !== undefined && (
              <p className="text-xs text-muted-foreground">
                読取期限: {new Date(expiresAt).toLocaleTimeString("ja-JP")}
              </p>
            )}
          </div>
        )}

        {state.kind === "complete" && (
          <p role="status" className="text-sm text-success">
            全フレームのSHA-256整合性を確認しました。
          </p>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          SHA-256は転送中の欠損・混在検出用であり、送信者の真正性を証明しません。
        </p>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>読み取りを完了できません</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 cursor-pointer focus-visible:ring-2"
            disabled={!cameraAvailable}
            onClick={() => {
              setError(null)
              setCameraGeneration((value) => value + 1)
            }}
          >
            <RefreshCw aria-hidden="true" />
            カメラを再起動
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 cursor-pointer focus-visible:ring-2"
            onClick={() => {
              session.discard()
              const next = session.state()
              previousKindRef.current = next.kind
              setState(next)
              setError(null)
              setCameraGeneration((value) => value + 1)
            }}
          >
            <Trash2 aria-hidden="true" />
            読取状態を破棄
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
