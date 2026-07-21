import { useEffect, useRef, useState } from "react"
import { Camera, ScanLine, X } from "lucide-react"
import { startQrScan, type QrScanHandle } from "@/qr/decode"
import type { AppError } from "@/crypto/errors"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"

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

function mismatchMessage(text: string, expected: ScannerTarget): string {
  const actual = text.startsWith("OCP1:")
    ? "公開鍵"
    : text.startsWith("OCK1:")
      ? "共通鍵"
      : text.startsWith("OCM1:")
        ? "暗号文"
        : "本アプリ以外"
  return `これは${actual}のQRです。読取対象を${TARGET_LABEL[expected]}に切り替えてください。`
}

export interface QrScannerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ScannerTarget
  onScan: (payload: string) => void
  cameraAvailable?: boolean
}

export function QrScannerDialog({
  open,
  onOpenChange,
  target,
  onScan,
  cameraAvailable = true,
}: QrScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onScanRef = useRef(onScan)
  const onOpenChangeRef = useRef(onOpenChange)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState("カメラを準備しています…")
  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let handle: QrScanHandle | null = null
    queueMicrotask(() => {
      if (!cancelled) {
        setError(null)
        setStatus("カメラを準備しています…")
      }
    })

    const stop = () => {
      handle?.stop()
      handle = null
    }

    if (!cameraAvailable) {
      queueMicrotask(() => {
        if (!cancelled) {
          setError("この端末ではカメラを利用できません。ペイロードを貼り付けてください。")
        }
      })
      return stop
    }

    queueMicrotask(() => {
      if (cancelled) return
      const video = videoRef.current
      if (!video) {
        setError("カメラ画面を準備できませんでした。ダイアログを開き直してください。")
        return
      }
      void startQrScan(
        video,
        (text) => {
          if (cancelled) return
          if (!text.startsWith(TARGET_PREFIX[target])) {
            setError(mismatchMessage(text, target))
            setStatus("読取対象と異なるQRを拒否しました")
            stop()
            return
          }
          setStatus("QRコードを読み取りました")
          stop()
          onScanRef.current(text)
          onOpenChangeRef.current(false)
        },
        (scanError: AppError) => {
          if (cancelled) return
          setError(scanError.userMessage)
          setStatus("カメラでエラーが発生しました")
          stop()
        },
        { once: true },
      )
        .then((scanHandle) => {
          if (cancelled) {
            scanHandle.stop()
          } else {
            handle = scanHandle
            setStatus("QRコードを枠内に合わせてください")
          }
        })
        .catch(() => {
          if (!cancelled) {
            setError(
              "カメラを起動できませんでした。ブラウザーの設定でカメラを許可してください。",
            )
            setStatus("カメラを起動できませんでした")
          }
        })
    })

    return () => {
      cancelled = true
      stop()
    }
  }, [cameraAvailable, open, target])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md [&>button.absolute]:hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera aria-hidden="true" />
            {TARGET_LABEL[target]}QRを読み取る
          </DialogTitle>
          <DialogDescription>
            カメラ画像は保存されません。閉じるとカメラを停止します。
          </DialogDescription>
        </DialogHeader>
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
        </div>
        <p aria-live="polite" className="text-center text-sm text-muted-foreground">
          {status}
        </p>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-11 cursor-pointer focus-visible:ring-2"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" />
            キャンセル
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
