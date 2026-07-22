import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { AlertCircle, Clipboard, Download, FileCode2, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { QrDisplay } from "@/components/qr-display"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toAppError } from "@/crypto/errors"
import { generateArtifactId } from "@/crypto/random"
import { formatDateTime } from "@/features/presentation"
import { ecLevelFor } from "@/qr/encode"
import {
  buildExportFileName,
  copyTextToClipboard,
  qrPngBlob,
  qrSvgBlob,
  triggerDownload,
} from "@/qr/export-image"
import type { StoredQrArtifact } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { qrNameSchema } from "@/schemas/key-schema"
import {
  deleteQrArtifact,
  listQrArtifacts,
  markQrViewed,
  renameQrArtifact,
} from "@/storage/qr-repository"

const KIND_LABEL: Record<StoredQrArtifact["kind"], string> = {
  "symmetric-key": "共通鍵QR",
  "public-key": "公開鍵QR (旧形式)",
  "encrypted-private-key": "暗号化済み秘密鍵QR",
}

export function SavedPage() {
  const [artifacts, setArtifacts] = useState<StoredQrArtifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<StoredQrArtifact | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [showQr, setShowQr] = useState(false)
  const [secretAcknowledged, setSecretAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setArtifacts(await listQrArtifacts())
      setError(null)
    } catch {
      setError("保存済み鍵QRを読み込めませんでした。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refresh())
  }, [refresh])

  const openDetails = (artifact: StoredQrArtifact) => {
    setSelected(artifact)
    setRenameValue(artifact.name)
    setShowQr(false)
    setSecretAcknowledged(artifact.sensitivity === "public")
    setError(null)
  }

  const rename = async () => {
    if (!selected) return
    const parsed = qrNameSchema.safeParse(renameValue)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "名前を確認してください。")
      return
    }
    setBusy(true)
    try {
      await renameQrArtifact(selected.id, parsed.data)
      setSelected({ ...selected, name: parsed.data })
      await refresh()
      toast.success("名前を変更しました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await deleteQrArtifact(selected.id)
      setSelected(null)
      await refresh()
      toast.success("保存済み鍵QRを削除しました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!selected) return
    try {
      await copyTextToClipboard(selected.payload)
      toast.success("ペイロードをコピーしました")
    } catch {
      setError("コピーできませんでした。")
    }
  }

  const exportQr = async (format: "png" | "svg") => {
    if (!selected) return
    setBusy(true)
    try {
      const ecLevel = ecLevelFor("stored-key", { qrErrorCorrection: "Q" })
      const blob =
        format === "png"
          ? await qrPngBlob(selected.payload, { ecLevel, size: env.qrRenderSize })
          : await qrSvgBlob(selected.payload, { ecLevel })
      triggerDownload(
        blob,
        buildExportFileName(selected.name, generateArtifactId(), format),
      )
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").userMessage)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6" aria-busy={busy}>
      <div>
        <h2 className="text-[1.375rem] font-bold tracking-tight">保存済み鍵QR</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          メッセージ暗号文はアプリ内へ保存しません。
        </p>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>操作を完了できません</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!loading && artifacts.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6 text-center">
            <p className="text-sm text-muted-foreground">保存済み鍵QRはありません。</p>
            <Button asChild className="h-11">
              <Link to="/keys">鍵ページを開く</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              className="w-full cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2"
              onClick={() => openDetails(artifact)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{artifact.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {KIND_LABEL[artifact.kind]} · {formatDateTime(artifact.createdAt)}
                  </p>
                </div>
                <SensitivityBadge sensitivity={artifact.sensitivity} />
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className="max-h-[95dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>保存済み鍵QRの詳細と出力操作です。</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid gap-2 text-sm">
                <Detail label="種別" value={KIND_LABEL[selected.kind]} />
                <Detail label="アルゴリズム" value={selected.algorithm} />
                <Detail label="SHA-256" value={selected.payloadSha256} mono />
                <Detail label="作成日時" value={formatDateTime(selected.createdAt)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="saved-name">名前</Label>
                <div className="flex gap-2">
                  <Input
                    id="saved-name"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    maxLength={80}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void rename()}
                    aria-label="名前を変更"
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {selected.sensitivity !== "public" && (
                <Alert variant="destructive">
                  <AlertTitle>秘密鍵を含みます</AlertTitle>
                  <AlertDescription>
                    <div className="mt-2 flex items-start gap-2">
                      <Checkbox
                        id="saved-secret-ack"
                        checked={secretAcknowledged}
                        onCheckedChange={(checked) =>
                          setSecretAcknowledged(checked === true)
                        }
                      />
                      <Label htmlFor="saved-secret-ack">
                        第三者に見せないことを理解しました
                      </Label>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              {!showQr ? (
                <Button
                  type="button"
                  className="h-11 w-full"
                  disabled={!secretAcknowledged}
                  onClick={() => setShowQr(true)}
                >
                  QRを表示
                </Button>
              ) : (
                <QrDisplay
                  payload={selected.payload}
                  ecLevel={ecLevelFor("stored-key", { qrErrorCorrection: "Q" })}
                  size={env.qrRenderSize}
                  title={selected.name}
                  onRendered={() => void markQrViewed(selected.id, Date.now())}
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !secretAcknowledged}
                  onClick={() => void exportQr("png")}
                >
                  <Download aria-hidden="true" />
                  PNG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !secretAcknowledged}
                  onClick={() => void exportQr("svg")}
                >
                  <FileCode2 aria-hidden="true" />
                  SVG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!secretAcknowledged}
                  onClick={() => void copy()}
                >
                  <Clipboard aria-hidden="true" />
                  コピー
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  <Trash2 aria-hidden="true" />
                  削除
                </Button>
              </div>
            </div>
          )}
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </section>
  )
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  )
}
