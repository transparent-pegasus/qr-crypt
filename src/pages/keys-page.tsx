import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  Clipboard,
  Download,
  FileCode2,
  FileText,
  KeyRound,
  LoaderCircle,
  MoreVertical,
  Pencil,
  QrCode,
  Save,
  ScanLine,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import {
  buildPublicKeyEnvelope,
  buildSymmetricKeyEnvelope,
  createRsaKeyPairRecord,
  createSymmetricKeyRecord,
  importPublicKeyRecord,
  importSymmetricKeyRecord,
} from "@/crypto/key-generation"
import { AppError, toAppError } from "@/crypto/errors"
import { generateArtifactId } from "@/crypto/random"
import { useFeatureSupport, useSensitiveSession } from "@/app/providers"
import { QrDisplay } from "@/components/qr-display"
import { QrScannerDialog } from "@/components/qr-scanner-dialog"
import { SensitivityBadge } from "@/components/sensitivity-badge"
import {
  SensitiveDataWarning,
  SECRET_QR_WARNING,
} from "@/components/sensitive-data-warning"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime, formatFingerprint } from "@/features/presentation"
import { useKeys } from "@/hooks/use-keys"
import {
  buildExportFileName,
  copyTextToClipboard,
  qrPngBlob,
  qrSvgBlob,
  triggerDownload,
} from "@/qr/export-image"
import { decodePayload, encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"
import type { QrArtifactKind, StoredKeyRecord, StoredQrArtifact } from "@/schemas/domain"
import { sensitivityForKind } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { keyNameSchema, qrNameSchema } from "@/schemas/key-schema"
import {
  deleteKeyRecord,
  findKeyByFingerprint,
  renameKeyRecord,
  saveKeyRecord,
} from "@/storage/key-repository"
import { saveQrArtifact } from "@/storage/qr-repository"

type KeysTab = "symmetric" | "rsa" | "import"
type ImportTarget = "symmetric-key" | "public-key"

interface KeyQrSession {
  record: StoredKeyRecord
  payload: string
  kind: "symmetric-key" | "public-key"
  name: string
}

export function KeysPage() {
  const { keys, loading, error: keysError, refresh } = useKeys()
  const { camera } = useFeatureSupport()
  const { setSensitiveSession, resetSensitiveSession } = useSensitiveSession()
  const [tab, setTab] = useState<KeysTab>("symmetric")
  const [symmetricName, setSymmetricName] = useState("")
  const [rsaName, setRsaName] = useState("")
  const [generating, setGenerating] = useState(false)
  const [qrBuilding, setQrBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateKeyName, setDuplicateKeyName] = useState<string | null>(null)
  const [secretWarningRecord, setSecretWarningRecord] = useState<StoredKeyRecord | null>(
    null,
  )
  const [qrSession, setQrSession] = useState<KeyQrSession | null>(null)
  const [qrRiskApproved, setQrRiskApproved] = useState(false)
  const [duplicateArtifact, setDuplicateArtifact] = useState<StoredQrArtifact | null>(
    null,
  )
  const [renameTarget, setRenameTarget] = useState<StoredKeyRecord | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<StoredKeyRecord | null>(null)
  const [deleteApproved, setDeleteApproved] = useState(false)
  const [importTarget, setImportTarget] = useState<ImportTarget>("symmetric-key")
  const [scannerOpen, setScannerOpen] = useState(false)
  const [importCandidate, setImportCandidate] = useState<StoredKeyRecord | null>(null)
  const [importName, setImportName] = useState("")
  const [importTrusted, setImportTrusted] = useState(false)
  const [importDuplicateName, setImportDuplicateName] = useState<string | null>(null)

  const symmetricKeys = useMemo(
    () => keys.filter((key) => key.kind === "symmetric"),
    [keys],
  )
  const rsaKeys = useMemo(() => keys.filter((key) => key.kind !== "symmetric"), [keys])
  const secretVisible = qrSession?.kind === "symmetric-key"

  useEffect(() => {
    setSensitiveSession({
      hasPlaintext: false,
      hasDecrypted: false,
      cryptoBusy: generating || qrBuilding,
      secretVisible,
    })
  }, [generating, qrBuilding, secretVisible, setSensitiveSession])
  useEffect(() => () => resetSensitiveSession(), [resetSensitiveSession])

  const reportDuplicate = async (fingerprint: string) => {
    const existing = await findKeyByFingerprint(fingerprint)
    setDuplicateKeyName(existing?.name ?? "既存の鍵")
  }

  const generateSymmetric = async () => {
    const parsed = keyNameSchema.safeParse(symmetricName)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "鍵名を確認してください。")
      return
    }
    setGenerating(true)
    setError(null)
    setDuplicateKeyName(null)
    try {
      const record = await createSymmetricKeyRecord(parsed.data, Date.now())
      try {
        await saveKeyRecord(record)
      } catch (caught: unknown) {
        if (caught instanceof AppError && caught.code === "DUPLICATE_KEY") {
          await reportDuplicate(record.fingerprint)
          return
        }
        throw caught
      }
      setSymmetricName("")
      await refresh()
      toast.success("共通鍵を生成しました")
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setGenerating(false)
    }
  }

  const generateRsa = async () => {
    const parsed = keyNameSchema.safeParse(rsaName)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "鍵ペア名を確認してください。")
      return
    }
    setGenerating(true)
    setError(null)
    setDuplicateKeyName(null)
    try {
      const record = await createRsaKeyPairRecord(parsed.data, Date.now())
      try {
        await saveKeyRecord(record)
      } catch (caught: unknown) {
        if (caught instanceof AppError && caught.code === "DUPLICATE_KEY") {
          await reportDuplicate(record.fingerprint)
          return
        }
        throw caught
      }
      setRsaName("")
      await refresh()
      toast.success("公開鍵ペアを生成しました")
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setGenerating(false)
    }
  }

  const openKeyQr = async (
    record: StoredKeyRecord,
    kind: "symmetric-key" | "public-key",
  ) => {
    setQrBuilding(true)
    setError(null)
    try {
      const envelope =
        kind === "symmetric-key"
          ? await buildSymmetricKeyEnvelope(record)
          : await buildPublicKeyEnvelope(record)
      const payload = encodeEnvelopeToPayload(envelope)
      setQrRiskApproved(false)
      setQrSession({
        record,
        payload,
        kind,
        name: `${kind === "symmetric-key" ? "共通鍵" : "公開鍵"}-${record.name}`,
      })
    } catch (caught: unknown) {
      setError(toAppError(caught, "QR_TOO_LARGE").userMessage)
    } finally {
      setQrBuilding(false)
      setSecretWarningRecord(null)
    }
  }

  const buildArtifact = async (): Promise<StoredQrArtifact | null> => {
    if (!qrSession) return null
    const parsed = qrNameSchema.safeParse(qrSession.name)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "QR名を確認してください。")
      return null
    }
    const kind: QrArtifactKind = qrSession.kind
    return {
      id: generateArtifactId(),
      name: parsed.data,
      kind,
      sensitivity: sensitivityForKind(kind),
      algorithm: qrSession.record.algorithm,
      payload: qrSession.payload,
      payloadSha256: await payloadSha256Hex(qrSession.payload),
      byteLength: new TextEncoder().encode(qrSession.payload).byteLength,
      createdAt: Date.now(),
      keyId: qrSession.record.id,
    }
  }

  const saveCurrentQr = async () => {
    try {
      const artifact = await buildArtifact()
      if (!artifact) return
      await saveQrArtifact(artifact)
      toast.success("鍵QRを保存しました")
    } catch (caught: unknown) {
      if (caught instanceof AppError && caught.code === "DUPLICATE_QR") {
        const artifact = await buildArtifact()
        if (artifact) setDuplicateArtifact(artifact)
        return
      }
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const saveDuplicateQr = async () => {
    if (!duplicateArtifact) return
    try {
      await saveQrArtifact(duplicateArtifact, { allowDuplicate: true })
      setDuplicateArtifact(null)
      toast.success("鍵QRを重複保存しました")
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const exportCurrentQr = async (format: "png" | "svg") => {
    if (!qrSession) return
    const parsed = qrNameSchema.safeParse(qrSession.name)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "QR名を確認してください。")
      return
    }
    try {
      const options = { ecLevel: "H" as const, size: env.qrRenderSize }
      const blob =
        format === "png"
          ? await qrPngBlob(qrSession.payload, options)
          : await qrSvgBlob(qrSession.payload, options)
      triggerDownload(blob, buildExportFileName(parsed.data, qrSession.record.id, format))
    } catch (caught: unknown) {
      setError(toAppError(caught, "QR_TOO_LARGE").userMessage)
    }
  }

  const copyCurrentQr = async () => {
    if (!qrSession) return
    try {
      await copyTextToClipboard(qrSession.payload)
      toast.success(
        qrSession.kind === "symmetric-key"
          ? "コピーしました。クリップボード同期に注意してください"
          : "公開鍵ペイロードをコピーしました",
      )
    } catch {
      setError("コピーできませんでした。ブラウザーの権限を確認してください。")
    }
  }

  const exportPublicKeyText = async (record: StoredKeyRecord) => {
    setQrBuilding(true)
    setError(null)
    try {
      const payload = encodeEnvelopeToPayload(await buildPublicKeyEnvelope(record))
      const blob = new Blob([payload], { type: "text/plain;charset=utf-8" })
      triggerDownload(blob, buildExportFileName(record.name, record.id, "txt"))
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setQrBuilding(false)
    }
  }

  const performRename = async () => {
    if (!renameTarget) return
    const parsed = keyNameSchema.safeParse(renameValue)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "鍵名を確認してください。")
      return
    }
    try {
      await renameKeyRecord(renameTarget.id, parsed.data)
      setRenameTarget(null)
      await refresh()
      toast.success("鍵名を変更しました")
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const performDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteKeyRecord(deleteTarget.id)
      setDeleteTarget(null)
      setDeleteApproved(false)
      await refresh()
      toast.success("鍵を削除しました")
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const prepareImport = async (payload: string) => {
    setError(null)
    setImportCandidate(null)
    setImportDuplicateName(null)
    setImportTrusted(false)
    try {
      const decoded = decodePayload(payload)
      const now = Date.now()
      const proposal = decoded.kind === "symmetric-key" ? "共通鍵-取込" : "公開鍵-取込"
      const candidate =
        decoded.kind === "symmetric-key"
          ? await importSymmetricKeyRecord(proposal, decoded.envelope, now)
          : decoded.kind === "public-key"
            ? await importPublicKeyRecord(proposal, decoded.envelope, now)
            : null
      if (!candidate) {
        setError("これは暗号文のQRです。読取対象を切り替えてください。")
        return
      }
      const duplicate = await findKeyByFingerprint(candidate.fingerprint)
      setImportCandidate(candidate)
      setImportName(proposal)
      setImportDuplicateName(duplicate?.name ?? null)
    } catch (caught: unknown) {
      setError(toAppError(caught, "INVALID_QR_PAYLOAD").userMessage)
    }
  }

  const saveImportedKey = async () => {
    if (!importCandidate) return
    const parsed = keyNameSchema.safeParse(importName)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "鍵名を確認してください。")
      return
    }
    try {
      await saveKeyRecord({ ...importCandidate, name: parsed.data })
      setImportCandidate(null)
      setImportName("")
      setImportTrusted(false)
      await refresh()
      toast.success("鍵を取り込みました")
    } catch (caught: unknown) {
      if (caught instanceof AppError && caught.code === "DUPLICATE_KEY") {
        await reportDuplicate(importCandidate.fingerprint)
        return
      }
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const copyFingerprint = async (fingerprint: string) => {
    try {
      await copyTextToClipboard(fingerprint)
      toast.success("完全指紋をコピーしました")
    } catch {
      setError("完全指紋をコピーできませんでした。")
    }
  }

  const deleteNeedsStrongConfirmation = Boolean(
    deleteTarget?.kind === "rsa-key-pair" && deleteTarget.privateKey,
  )

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6">
      <h2 className="text-[1.375rem] font-bold tracking-tight">鍵管理</h2>
      <Tabs value={tab} onValueChange={(value) => setTab(value as KeysTab)}>
        <TabsList className="grid h-auto min-h-11 w-full grid-cols-3">
          <TabsTrigger value="symmetric" className="min-h-11 cursor-pointer px-2">
            共通鍵
          </TabsTrigger>
          <TabsTrigger value="rsa" className="min-h-11 cursor-pointer px-2">
            公開鍵ペア
          </TabsTrigger>
          <TabsTrigger value="import" className="min-h-11 cursor-pointer px-2">
            鍵を読み取る
          </TabsTrigger>
        </TabsList>

        <TabsContent value="symmetric" className="space-y-5 pt-3">
          <Card>
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base">共通鍵を生成</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <Label htmlFor="symmetric-key-name">鍵名</Label>
              <Input
                id="symmetric-key-name"
                value={symmetricName}
                onChange={(event) => setSymmetricName(event.target.value)}
                className="h-11 text-base focus-visible:ring-2"
                maxLength={80}
                placeholder="例: 端末A"
              />
              <Button
                type="button"
                className="h-11 w-full cursor-pointer focus-visible:ring-2"
                disabled={generating || !symmetricName.trim()}
                onClick={() => void generateSymmetric()}
              >
                {generating ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <KeyRound aria-hidden="true" />
                )}
                {generating ? "生成中…" : "共通鍵を生成"}
              </Button>
            </CardContent>
          </Card>
          <KeyList
            keys={symmetricKeys}
            loading={loading}
            onShowQr={(record) => setSecretWarningRecord(record)}
            onExportText={undefined}
            onRename={(record) => {
              setRenameTarget(record)
              setRenameValue(record.name)
            }}
            onDelete={(record) => setDeleteTarget(record)}
            onCopyFingerprint={copyFingerprint}
          />
        </TabsContent>

        <TabsContent value="rsa" className="space-y-5 pt-3">
          {!env.enableRsa ? (
            <Alert>
              <AlertCircle aria-hidden="true" className="size-4" />
              <AlertDescription>このビルドではRSA公開鍵機能が無効です。</AlertDescription>
            </Alert>
          ) : (
            <>
              <Card>
                <CardHeader className="p-4 pb-3">
                  <CardTitle className="text-base">鍵ペアを生成</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-4 pt-0">
                  <Label htmlFor="rsa-key-name">鍵ペア名</Label>
                  <Input
                    id="rsa-key-name"
                    value={rsaName}
                    onChange={(event) => setRsaName(event.target.value)}
                    className="h-11 text-base focus-visible:ring-2"
                    maxLength={80}
                    placeholder="例: 受信端末"
                  />
                  <Button
                    type="button"
                    className="h-11 w-full cursor-pointer focus-visible:ring-2"
                    disabled={generating || !rsaName.trim()}
                    onClick={() => void generateRsa()}
                  >
                    {generating && (
                      <LoaderCircle aria-hidden="true" className="animate-spin" />
                    )}
                    {generating ? "生成中…(数秒かかります)" : "鍵ペアを生成"}
                  </Button>
                </CardContent>
              </Card>
              <KeyList
                keys={rsaKeys}
                loading={loading}
                onShowQr={(record) => void openKeyQr(record, "public-key")}
                onExportText={(record) => void exportPublicKeyText(record)}
                onRename={(record) => {
                  setRenameTarget(record)
                  setRenameValue(record.name)
                }}
                onDelete={(record) => setDeleteTarget(record)}
                onCopyFingerprint={copyFingerprint}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="import" className="space-y-5 pt-3">
          <Card>
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base">読取対象を選択</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              <RadioGroup
                value={importTarget}
                onValueChange={(value) => {
                  setImportTarget(value as ImportTarget)
                  setImportCandidate(null)
                  setImportDuplicateName(null)
                }}
              >
                <div className="flex min-h-11 items-center gap-3">
                  <RadioGroupItem value="symmetric-key" id="scan-symmetric" />
                  <Label htmlFor="scan-symmetric" className="cursor-pointer">
                    共通鍵を読み取る
                  </Label>
                </div>
                <div className="flex min-h-11 items-center gap-3">
                  <RadioGroupItem value="public-key" id="scan-public" />
                  <Label htmlFor="scan-public" className="cursor-pointer">
                    公開鍵を読み取る
                  </Label>
                </div>
              </RadioGroup>
              <Button
                type="button"
                className="h-11 w-full cursor-pointer focus-visible:ring-2"
                disabled={!camera}
                onClick={() => setScannerOpen(true)}
              >
                <ScanLine aria-hidden="true" />
                カメラを起動
              </Button>
              {!camera && (
                <p className="flex gap-2 text-sm text-muted-foreground">
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  この端末ではカメラを利用できません。
                </p>
              )}
            </CardContent>
          </Card>

          {importCandidate && (
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base">取込内容の確認</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-0">
                <div className="grid gap-2 text-sm">
                  <KeyDetail
                    label="種別"
                    value={importCandidate.kind === "symmetric" ? "共通鍵" : "公開鍵"}
                  />
                  <KeyDetail label="方式" value={importCandidate.algorithm} mono />
                  <KeyDetail
                    label="短縮指紋"
                    value={formatFingerprint(importCandidate.fingerprint)}
                    mono
                  />
                  <KeyDetail
                    label="完全 SHA-256 hex"
                    value={importCandidate.fingerprint}
                    mono
                  />
                  <KeyDetail
                    label="作成日時"
                    value={formatDateTime(importCandidate.createdAt)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  相手の画面の指紋と一致することを確認してください。短縮表示は簡易照合です。厳密な照合には完全指紋を使用してください。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 cursor-pointer focus-visible:ring-2"
                  onClick={() => void copyFingerprint(importCandidate.fingerprint)}
                >
                  <Clipboard aria-hidden="true" />
                  完全指紋をコピー
                </Button>
                <div className="space-y-2">
                  <Label htmlFor="import-key-name">鍵名</Label>
                  <Input
                    id="import-key-name"
                    value={importName}
                    onChange={(event) => setImportName(event.target.value)}
                    className="h-11 text-base focus-visible:ring-2"
                    maxLength={80}
                  />
                </div>
                {importCandidate.kind === "symmetric" && (
                  <SensitiveDataWarning
                    strong
                    checked={importTrusted}
                    onCheckedChange={setImportTrusted}
                    confirmationLabel="この鍵の共有経路を信頼しています"
                  />
                )}
                {importDuplicateName && (
                  <Alert variant="destructive" role="alert">
                    <AlertCircle aria-hidden="true" className="size-4" />
                    <AlertTitle>DUPLICATE_KEY</AlertTitle>
                    <AlertDescription>
                      同じ内容の鍵「{importDuplicateName}」が保存済みです。
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  type="button"
                  className="h-11 w-full cursor-pointer focus-visible:ring-2"
                  disabled={
                    Boolean(importDuplicateName) ||
                    (importCandidate.kind === "symmetric" && !importTrusted)
                  }
                  onClick={() => void saveImportedKey()}
                >
                  <Save aria-hidden="true" />
                  鍵を保存
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {(keysError || error) && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>操作を完了できません</AlertTitle>
          <AlertDescription>{error ?? keysError}</AlertDescription>
        </Alert>
      )}
      {duplicateKeyName && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>DUPLICATE_KEY</AlertTitle>
          <AlertDescription>
            同じ内容の鍵「{duplicateKeyName}」がすでに保存されています。
          </AlertDescription>
        </Alert>
      )}

      <QrScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        target={importTarget}
        cameraAvailable={camera}
        onScan={(payload) => void prepareImport(payload)}
      />

      <AlertDialog
        open={secretWarningRecord !== null}
        onOpenChange={(open) => {
          if (!open) setSecretWarningRecord(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>共通鍵QRを表示します</AlertDialogTitle>
            <AlertDialogDescription>{SECRET_QR_WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (secretWarningRecord) {
                  void openKeyQr(secretWarningRecord, "symmetric-key")
                }
              }}
            >
              表示する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={qrSession !== null}
        onOpenChange={(open) => {
          if (!open) {
            setQrSession(null)
            setQrRiskApproved(false)
          }
        }}
      >
        <DialogContent className="max-h-[95dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {qrSession?.kind === "symmetric-key" ? "共通鍵QR" : "公開鍵QR"}
              {qrSession && (
                <SensitivityBadge sensitivity={sensitivityForKind(qrSession.kind)} />
              )}
            </DialogTitle>
            <DialogDescription>
              QRコードは白背景で表示します。鍵素材を共有する相手を確認してください。
            </DialogDescription>
          </DialogHeader>
          {qrSession && (
            <div className="space-y-4">
              {qrSession.kind === "symmetric-key" && (
                <SensitiveDataWarning
                  strong
                  checked={qrRiskApproved}
                  onCheckedChange={setQrRiskApproved}
                />
              )}
              <QrDisplay
                payload={qrSession.payload}
                ecLevel="H"
                size={env.qrRenderSize}
                title={qrSession.kind === "symmetric-key" ? "共通鍵QR" : "公開鍵QR"}
              />
              <div className="space-y-2">
                <Label htmlFor="key-qr-name">QR名</Label>
                <Input
                  id="key-qr-name"
                  value={qrSession.name}
                  onChange={(event) =>
                    setQrSession({ ...qrSession, name: event.target.value })
                  }
                  className="h-11 text-base focus-visible:ring-2"
                  maxLength={80}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  className="h-11 cursor-pointer focus-visible:ring-2"
                  disabled={qrSession.kind === "symmetric-key" && !qrRiskApproved}
                  onClick={() => void saveCurrentQr()}
                >
                  <Save aria-hidden="true" />
                  保存
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 cursor-pointer focus-visible:ring-2"
                  disabled={qrSession.kind === "symmetric-key" && !qrRiskApproved}
                  onClick={() => void exportCurrentQr("png")}
                >
                  <Download aria-hidden="true" />
                  PNG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 cursor-pointer focus-visible:ring-2"
                  disabled={qrSession.kind === "symmetric-key" && !qrRiskApproved}
                  onClick={() => void exportCurrentQr("svg")}
                >
                  <FileCode2 aria-hidden="true" />
                  SVG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 cursor-pointer focus-visible:ring-2"
                  disabled={qrSession.kind === "symmetric-key" && !qrRiskApproved}
                  onClick={() => void copyCurrentQr()}
                >
                  <Clipboard aria-hidden="true" />
                  コピー
                </Button>
              </div>
            </div>
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
            <DialogTitle>鍵名を変更</DialogTitle>
            <DialogDescription>鍵の内容と指紋は変わりません。</DialogDescription>
          </DialogHeader>
          <Label htmlFor="rename-key">新しい鍵名</Label>
          <Input
            id="rename-key"
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
            <AlertDialogTitle>鍵を削除しますか</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteNeedsStrongConfirmation
                ? "この鍵ペア宛の暗号文は二度と復号できなくなります。"
                : "この鍵で復号できなくなります。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteNeedsStrongConfirmation && (
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
              disabled={deleteNeedsStrongConfirmation && !deleteApproved}
              onClick={() => void performDelete()}
            >
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={duplicateArtifact !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateArtifact(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>同じ内容のQRが保存済みです</AlertDialogTitle>
            <AlertDialogDescription>
              確認後、別のIDで重複保存できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => void saveDuplicateQr()}>
              重複して保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function KeyList({
  keys,
  loading,
  onShowQr,
  onExportText,
  onRename,
  onDelete,
  onCopyFingerprint,
}: {
  keys: StoredKeyRecord[]
  loading: boolean
  onShowQr: (record: StoredKeyRecord) => void
  onExportText: ((record: StoredKeyRecord) => void) | undefined
  onRename: (record: StoredKeyRecord) => void
  onDelete: (record: StoredKeyRecord) => void
  onCopyFingerprint: (fingerprint: string) => Promise<void>
}) {
  if (loading)
    return <p className="text-sm text-muted-foreground">鍵を読み込んでいます…</p>
  if (keys.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        保存されている鍵はありません。
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const secret = key.kind === "symmetric"
        const hasPrivate = key.kind === "rsa-key-pair" && Boolean(key.privateKey)
        return (
          <Card key={key.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{key.name}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {formatFingerprint(key.fingerprint)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {secret ? (
                    <SensitivityBadge sensitivity="secret" />
                  ) : hasPrivate ? (
                    <Badge className="gap-1 bg-success text-success-foreground">
                      <ShieldCheck aria-hidden="true" className="size-3.5" />
                      秘密鍵あり
                    </Badge>
                  ) : (
                    <Badge variant="secondary">公開鍵のみ</Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 cursor-pointer focus-visible:ring-2"
                        aria-label={`${key.name}の操作`}
                      >
                        <MoreVertical aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onShowQr(key)}>
                        <QrCode aria-hidden="true" />
                        {secret ? "QRを表示" : "公開鍵QRを表示"}
                      </DropdownMenuItem>
                      {onExportText && (
                        <DropdownMenuItem onSelect={() => onExportText(key)}>
                          <FileText aria-hidden="true" />
                          公開鍵をファイル出力
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => onRename(key)}>
                        <Pencil aria-hidden="true" />
                        名前を変更
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => onDelete(key)}
                      >
                        <Trash2 aria-hidden="true" />
                        削除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {!secret && !hasPrivate && (
                <p className="text-xs text-muted-foreground">
                  この端末では復号できません
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <span>作成: {formatDateTime(key.createdAt)}</span>
                <span>使用回数: {key.useCount}</span>
                <span className="col-span-2">
                  最終使用: {formatDateTime(key.lastUsedAt)}
                </span>
              </div>
              <div className="rounded-md border bg-background p-3">
                <p className="text-xs text-muted-foreground">完全 SHA-256 hex</p>
                <p className="mt-1 break-all font-mono text-xs select-text">
                  {key.fingerprint}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-2 h-11 cursor-pointer px-3 focus-visible:ring-2"
                  onClick={() => void onCopyFingerprint(key.fingerprint)}
                >
                  <Clipboard aria-hidden="true" />
                  完全指紋をコピー
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function KeyDetail({
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
      <span
        className={`min-w-0 break-all select-text ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  )
}
