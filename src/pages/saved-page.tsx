import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertCircle,
  Archive,
  Clipboard,
  Download,
  Eye,
  FileCode2,
  MoreVertical,
  Pencil,
  QrCode,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { toAppError } from "@/crypto/errors"
import { useSensitiveSession } from "@/app/providers"
import { QrDisplay } from "@/components/qr-display"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import { SensitiveDataWarning } from "@/components/sensitive-data-warning"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime, shortTechnicalId } from "@/features/presentation"
import { usePreferences } from "@/hooks/use-preferences"
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

type SavedFilter = "all" | "ciphertext" | "keys"
type ProtectedAction = "display" | "png" | "svg" | "copy"

interface PendingProtectedAction {
  artifact: StoredQrArtifact
  action: ProtectedAction
}

const KIND_LABEL: Record<StoredQrArtifact["kind"], string> = {
  ciphertext: "暗号文",
  "symmetric-key": "共通鍵",
  "public-key": "公開鍵",
  "encrypted-private-key": "秘密鍵バックアップ",
}

export function SavedPage() {
  const { preferences } = usePreferences()
  const { setSensitiveSession, resetSensitiveSession } = useSensitiveSession()
  const [artifacts, setArtifacts] = useState<StoredQrArtifact[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<SavedFilter>("all")
  const [detailArtifact, setDetailArtifact] = useState<StoredQrArtifact | null>(null)
  const [displayArtifact, setDisplayArtifact] = useState<StoredQrArtifact | null>(null)
  const [renameTarget, setRenameTarget] = useState<StoredQrArtifact | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<StoredQrArtifact | null>(null)
  const [deleteApproved, setDeleteApproved] = useState(false)
  const [protectedAction, setProtectedAction] = useState<PendingProtectedAction | null>(
    null,
  )
  const [protectedApproved, setProtectedApproved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadArtifacts = useCallback(async () => {
    try {
      setArtifacts(await listQrArtifacts())
      setError(null)
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void loadArtifacts())
  }, [loadArtifacts])

  useEffect(() => {
    setSensitiveSession({
      hasPlaintext: false,
      hasDecrypted: false,
      cryptoBusy: false,
      secretVisible: displayArtifact?.sensitivity === "secret",
    })
  }, [displayArtifact, setSensitiveSession])
  useEffect(() => () => resetSensitiveSession(), [resetSensitiveSession])

  const visibleArtifacts = useMemo(() => {
    if (filter === "all") return artifacts
    if (filter === "ciphertext") {
      return artifacts.filter((artifact) => artifact.kind === "ciphertext")
    }
    return artifacts.filter((artifact) => artifact.kind !== "ciphertext")
  }, [artifacts, filter])

  const ecLevelForArtifact = (artifact: StoredQrArtifact) =>
    artifact.kind === "ciphertext" ? preferences.qrErrorCorrection : "H"

  const performProtectedAction = async (
    artifact: StoredQrArtifact,
    action: ProtectedAction,
  ) => {
    try {
      if (action === "display") {
        setDisplayArtifact(artifact)
        return
      }
      if (action === "copy") {
        await copyTextToClipboard(artifact.payload)
        toast.success(
          artifact.sensitivity === "secret"
            ? "コピーしました。クリップボード同期に注意してください"
            : "ペイロードをコピーしました",
        )
        return
      }
      const ecLevel = ecLevelForArtifact(artifact)
      const blob =
        action === "png"
          ? await qrPngBlob(artifact.payload, {
              ecLevel,
              size: env.qrRenderSize,
            })
          : await qrSvgBlob(artifact.payload, { ecLevel })
      triggerDownload(blob, buildExportFileName(artifact.name, artifact.id, action))
    } catch (caught: unknown) {
      setError(toAppError(caught, "QR_TOO_LARGE").userMessage)
    }
  }

  const requestProtectedAction = (
    artifact: StoredQrArtifact,
    action: ProtectedAction,
  ) => {
    if (artifact.sensitivity === "secret") {
      setProtectedApproved(false)
      setProtectedAction({ artifact, action })
    } else {
      void performProtectedAction(artifact, action)
    }
  }

  const confirmProtectedAction = () => {
    if (!protectedAction) return
    const pending = protectedAction
    setProtectedAction(null)
    setProtectedApproved(false)
    void performProtectedAction(pending.artifact, pending.action)
  }

  const recordViewed = async (artifact: StoredQrArtifact) => {
    try {
      await markQrViewed(artifact.id, Date.now())
      await loadArtifacts()
    } catch {
      setError("QRコードは表示しましたが、最終表示日時を更新できませんでした。")
    }
  }

  const performRename = async () => {
    if (!renameTarget) return
    const parsed = qrNameSchema.safeParse(renameValue)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "QR名を確認してください。")
      return
    }
    try {
      await renameQrArtifact(renameTarget.id, parsed.data)
      setRenameTarget(null)
      await loadArtifacts()
      toast.success("QR名を変更しました")
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const performDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteQrArtifact(deleteTarget.id)
      if (detailArtifact?.id === deleteTarget.id) setDetailArtifact(null)
      setDeleteTarget(null)
      setDeleteApproved(false)
      await loadArtifacts()
      toast.success("保存済みQRを削除しました")
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const copyHash = async (hash: string) => {
    try {
      await copyTextToClipboard(hash)
      toast.success("SHA-256をコピーしました")
    } catch {
      setError("SHA-256をコピーできませんでした。")
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-[1.375rem] font-bold tracking-tight">保存済みQR</h2>
        <p className="font-mono text-sm text-muted-foreground">{artifacts.length} 件</p>
      </div>

      <Tabs value={filter} onValueChange={(value) => setFilter(value as SavedFilter)}>
        <TabsList className="grid h-11 w-full grid-cols-3">
          <TabsTrigger value="all" className="h-9 cursor-pointer">
            すべて
          </TabsTrigger>
          <TabsTrigger value="ciphertext" className="h-9 cursor-pointer">
            暗号文
          </TabsTrigger>
          <TabsTrigger value="keys" className="h-9 cursor-pointer">
            鍵
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>操作を完了できません</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">保存済みQRを読み込んでいます…</p>
      ) : visibleArtifacts.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed p-8 text-center">
          <Archive aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="font-medium">保存済みのQRはありません</p>
          <Button
            asChild
            variant="outline"
            className="h-11 cursor-pointer focus-visible:ring-2"
          >
            <Link to="/encrypt">暗号化ページを開く</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleArtifacts.map((artifact) => (
            <Card key={artifact.id}>
              <CardContent className="p-0">
                <div className="flex items-start gap-1 p-4">
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setDetailArtifact(artifact)}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="truncate font-medium">{artifact.name}</span>
                      <SensitivityBadge sensitivity={artifact.sensitivity} />
                    </span>
                    <span className="mt-2 block font-mono text-xs text-muted-foreground">
                      {KIND_LABEL[artifact.kind]}・{artifact.algorithm}・
                      {artifact.byteLength} bytes
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      作成 {formatDateTime(artifact.createdAt)} / 最終表示{" "}
                      {formatDateTime(artifact.lastViewedAt)}
                    </span>
                    <span className="mt-1 block font-mono text-xs text-muted-foreground">
                      鍵ID {shortTechnicalId(artifact.keyId)} / SHA-256{" "}
                      {shortTechnicalId(artifact.payloadSha256)}
                    </span>
                  </button>
                  <ArtifactMenu
                    artifact={artifact}
                    onDisplay={(item) => requestProtectedAction(item, "display")}
                    onRename={(item) => {
                      setRenameTarget(item)
                      setRenameValue(item.name)
                    }}
                    onPng={(item) => requestProtectedAction(item, "png")}
                    onSvg={(item) => requestProtectedAction(item, "svg")}
                    onCopy={(item) => requestProtectedAction(item, "copy")}
                    onDelete={setDeleteTarget}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={detailArtifact !== null}
        onOpenChange={(open) => {
          if (!open) setDetailArtifact(null)
        }}
      >
        <SheetContent className="w-[92vw] overflow-y-auto sm:max-w-md">
          {detailArtifact && (
            <div className="space-y-5">
              <SheetHeader>
                <SheetTitle className="pr-8">{detailArtifact.name}</SheetTitle>
                <SheetDescription>保存済みQRの詳細情報</SheetDescription>
              </SheetHeader>
              {detailArtifact.sensitivity === "secret" && <SensitiveDataWarning />}
              <div className="grid gap-2 text-sm">
                <ArtifactDetail label="種別" value={KIND_LABEL[detailArtifact.kind]} />
                <ArtifactDetail label="方式" value={detailArtifact.algorithm} mono />
                <ArtifactDetail
                  label="作成日時"
                  value={formatDateTime(detailArtifact.createdAt)}
                />
                <ArtifactDetail
                  label="サイズ"
                  value={`${detailArtifact.byteLength} bytes`}
                  mono
                />
                <ArtifactDetail label="鍵ID" value={detailArtifact.keyId ?? "—"} mono />
                <ArtifactDetail
                  label="機密度"
                  value={
                    detailArtifact.sensitivity === "public"
                      ? "公開"
                      : detailArtifact.sensitivity === "confidential"
                        ? "機密"
                        : "最高機密"
                  }
                />
                <ArtifactDetail
                  label="最終表示"
                  value={formatDateTime(detailArtifact.lastViewedAt)}
                />
                <ArtifactDetail
                  label="完全 SHA-256 hex"
                  value={detailArtifact.payloadSha256}
                  mono
                />
              </div>
              <p className="text-xs text-muted-foreground">
                短縮表示は簡易照合です。厳密な照合には完全SHA-256を使用してください。
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full cursor-pointer focus-visible:ring-2"
                onClick={() => void copyHash(detailArtifact.payloadSha256)}
              >
                <Clipboard aria-hidden="true" />
                完全SHA-256をコピー
              </Button>
              <Button
                type="button"
                className="h-11 w-full cursor-pointer focus-visible:ring-2"
                onClick={() => requestProtectedAction(detailArtifact, "display")}
              >
                <QrCode aria-hidden="true" />
                QRを表示
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 cursor-pointer focus-visible:ring-2"
                  onClick={() => requestProtectedAction(detailArtifact, "png")}
                >
                  <Download aria-hidden="true" />
                  PNG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 cursor-pointer focus-visible:ring-2"
                  onClick={() => requestProtectedAction(detailArtifact, "svg")}
                >
                  <FileCode2 aria-hidden="true" />
                  SVG
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={displayArtifact !== null}
        onOpenChange={(open) => {
          if (!open) setDisplayArtifact(null)
        }}
      >
        <DialogContent className="max-h-[95dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
              {displayArtifact?.name}
              {displayArtifact && (
                <SensitivityBadge sensitivity={displayArtifact.sensitivity} />
              )}
            </DialogTitle>
            <DialogDescription>保存済みQRを表示しています。</DialogDescription>
          </DialogHeader>
          {displayArtifact && (
            <>
              {displayArtifact.sensitivity === "secret" && <SensitiveDataWarning />}
              <QrDisplay
                payload={displayArtifact.payload}
                ecLevel={ecLevelForArtifact(displayArtifact)}
                size={env.qrRenderSize}
                title={displayArtifact.name}
                onRendered={() => void recordViewed(displayArtifact)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QR名を変更</DialogTitle>
            <DialogDescription>ペイロードの内容は変わりません。</DialogDescription>
          </DialogHeader>
          <Label htmlFor="rename-artifact">新しいQR名</Label>
          <Input
            id="rename-artifact"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            className="h-11 text-base focus-visible:ring-2"
            maxLength={80}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 cursor-pointer"
              onClick={() => setRenameTarget(null)}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              className="h-11 cursor-pointer"
              onClick={() => void performRename()}
            >
              変更する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteApproved(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>保存済みQRを削除しますか</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.sensitivity === "secret"
                ? "この鍵のQRを削除しても、アプリ内の鍵本体は削除されません。"
                : "この操作は元に戻せません。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget?.sensitivity === "secret" && (
            <SensitiveDataWarning
              strong
              checked={deleteApproved}
              onCheckedChange={setDeleteApproved}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteTarget?.sensitivity === "secret" && !deleteApproved}
              onClick={() => void performDelete()}
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={protectedAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setProtectedAction(null)
            setProtectedApproved(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>最高機密QRの操作</AlertDialogTitle>
            <AlertDialogDescription>
              表示・出力・コピーした内容が他の端末へ同期されないことを確認してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <SensitiveDataWarning
            strong
            checked={protectedApproved}
            onCheckedChange={setProtectedApproved}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={!protectedApproved}
              onClick={confirmProtectedAction}
            >
              続ける
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function ArtifactMenu({
  artifact,
  onDisplay,
  onRename,
  onPng,
  onSvg,
  onCopy,
  onDelete,
}: {
  artifact: StoredQrArtifact
  onDisplay: (artifact: StoredQrArtifact) => void
  onRename: (artifact: StoredQrArtifact) => void
  onPng: (artifact: StoredQrArtifact) => void
  onSvg: (artifact: StoredQrArtifact) => void
  onCopy: (artifact: StoredQrArtifact) => void
  onDelete: (artifact: StoredQrArtifact) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 cursor-pointer focus-visible:ring-2"
          aria-label={`${artifact.name}の操作`}
        >
          <MoreVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onDisplay(artifact)}>
          <Eye aria-hidden="true" />
          表示
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRename(artifact)}>
          <Pencil aria-hidden="true" />
          名前を変更
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPng(artifact)}>
          <Download aria-hidden="true" />
          PNG
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSvg(artifact)}>
          <FileCode2 aria-hidden="true" />
          SVG
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopy(artifact)}>
          <Clipboard aria-hidden="true" />
          コピー
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onDelete(artifact)}
        >
          <Trash2 aria-hidden="true" />
          削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ArtifactDetail({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 border-b py-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 break-all select-text ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  )
}
