import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Download,
  Eraser,
  FileCode2,
  LoaderCircle,
  Lock,
  Save,
  ScanLine,
} from "lucide-react"
import { toast } from "sonner"
import { encryptWithAesKey, decryptWithAesKey } from "@/crypto/aes-gcm"
import { AppError, toAppError } from "@/crypto/errors"
import type { MessageEnvelope } from "@/crypto/envelope"
import { generateArtifactId } from "@/crypto/random"
import { decryptRsaHybrid, encryptRsaHybrid } from "@/crypto/rsa-hybrid"
import {
  useFeatureSupport,
  useSensitiveSession,
  useTransientClear,
} from "@/app/providers"
import { QrDisplay } from "@/components/qr-display"
import { QrScannerDialog } from "@/components/qr-scanner-dialog"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  ALGORITHM_LABELS,
  formatDateTime,
  formatFingerprint,
  formatSuggestedDate,
  shortTechnicalId,
} from "@/features/presentation"
import { useAutoClear } from "@/hooks/use-auto-clear"
import { useKeys } from "@/hooks/use-keys"
import { usePreferences } from "@/hooks/use-preferences"
import { bytesToHex, bytesToUtf8, utf8ToBytes } from "@/lib/bytes"
import { estimatePayloadChars, payloadFits, qrByteCapacity } from "@/qr/encode"
import {
  buildExportFileName,
  copyTextToClipboard,
  qrPngBlob,
  qrSvgBlob,
  triggerDownload,
} from "@/qr/export-image"
import { decodePayload, encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"
import type { StoredKeyRecord, StoredQrArtifact, UiAlgorithm } from "@/schemas/domain"
import { toUiAlgorithm } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { qrNameSchema } from "@/schemas/key-schema"
import { markKeyUsed } from "@/storage/key-repository"
import { saveQrArtifact } from "@/storage/qr-repository"

type PageMode = "encrypt" | "decrypt"

interface EncryptionResult {
  payload: string
  envelope: MessageEnvelope
  key: StoredKeyRecord
}

function matchingKeys(
  keys: StoredKeyRecord[],
  algorithm: UiAlgorithm,
  mode: PageMode,
): StoredKeyRecord[] {
  if (algorithm === "A256GCM") {
    return keys.filter((key) => key.kind === "symmetric" && key.symmetricKey)
  }
  if (mode === "decrypt") {
    return keys.filter((key) => key.kind === "rsa-key-pair" && key.privateKey)
  }
  return keys.filter(
    (key) => (key.kind === "rsa-key-pair" || key.kind === "public-key") && key.publicKey,
  )
}

function messageKeyId(envelope: MessageEnvelope): string {
  return "keyId" in envelope ? envelope.keyId : envelope.recipientKeyId
}

function messageCiphertextBytes(envelope: MessageEnvelope): number {
  return envelope.ciphertext.byteLength
}

export function EncryptPage() {
  const { keys, loading: keysLoading, error: keysError } = useKeys()
  const { preferences, error: preferencesError } = usePreferences()
  const { camera } = useFeatureSupport()
  const { nonce } = useTransientClear()
  const { setSensitiveSession, resetSensitiveSession } = useSensitiveSession()
  const [mode, setMode] = useState<PageMode>("encrypt")
  const [algorithmOverride, setAlgorithmOverride] = useState<UiAlgorithm | null>(null)
  const algorithm = algorithmOverride ?? preferences.defaultAlgorithm
  const [selectedKeyId, setSelectedKeyId] = useState("")
  const [plaintext, setPlaintext] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EncryptionResult | null>(null)
  const [qrName, setQrName] = useState("")
  const [saved, setSaved] = useState(false)
  const [duplicateArtifact, setDuplicateArtifact] = useState<StoredQrArtifact | null>(
    null,
  )
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [decryptInput, setDecryptInput] = useState("")
  const [decryptedText, setDecryptedText] = useState("")
  const [scannerOpen, setScannerOpen] = useState(false)
  const [clearStatus, setClearStatus] = useState("")

  const parsedMessage = useMemo(() => {
    if (!decryptInput.trim()) return null
    try {
      const decoded = decodePayload(decryptInput.trim())
      return decoded.kind === "message" ? decoded.envelope : null
    } catch {
      return null
    }
  }, [decryptInput])
  const decryptInputInvalid = decryptInput.trim().length > 0 && !parsedMessage
  const activeAlgorithm = parsedMessage
    ? toUiAlgorithm(parsedMessage.algorithm)
    : algorithm
  const eligibleKeys = matchingKeys(keys, activeAlgorithm, mode)
  const matchedKey = parsedMessage
    ? eligibleKeys.find((key) => key.id === messageKeyId(parsedMessage))
    : undefined
  const effectiveSelectedKeyId = eligibleKeys.some((key) => key.id === selectedKeyId)
    ? selectedKeyId
    : (matchedKey?.id ?? "")
  const selectedKey = eligibleKeys.find((key) => key.id === effectiveSelectedKeyId)

  const plaintextBytes = useMemo(
    () => new TextEncoder().encode(plaintext).byteLength,
    [plaintext],
  )
  const overPlaintextLimit = plaintextBytes > env.maxPlaintextBytes
  const estimatedPayload = useMemo(() => {
    try {
      return estimatePayloadChars(plaintextBytes, algorithm)
    } catch {
      return Math.ceil(plaintextBytes * 1.5) + 256
    }
  }, [algorithm, plaintextBytes])
  const estimatedFits = estimatedPayload <= qrByteCapacity(preferences.qrErrorCorrection)
  const canEncrypt =
    plaintext.length > 0 && !overPlaintextLimit && Boolean(selectedKey) && !busy

  useEffect(() => {
    setSensitiveSession({
      hasPlaintext: plaintext.length > 0,
      hasDecrypted: decryptedText.length > 0,
      cryptoBusy: busy,
      secretVisible: false,
    })
  }, [busy, decryptedText, plaintext, setSensitiveSession])

  useEffect(() => () => resetSensitiveSession(), [resetSensitiveSession])

  const clearTransient = useCallback(() => {
    setPlaintext("")
    setDecryptInput("")
    setDecryptedText("")
    setResult(null)
    setQrName("")
    setSaved(false)
    setError(null)
    setClearStatus("自動消去しました")
    toast.info("自動消去しました")
  }, [])

  useAutoClear({
    seconds: preferences.backgroundClearSeconds,
    onClear: clearTransient,
    clearNonce: nonce,
  })

  const handleEncrypt = async () => {
    if (!selectedKey || !canEncrypt) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const now = Date.now()
      const plaintextData = utf8ToBytes(plaintext)
      const envelope =
        algorithm === "A256GCM"
          ? await encryptWithAesKey({
              key: selectedKey.symmetricKey as CryptoKey,
              keyId: selectedKey.id,
              plaintext: plaintextData,
              now,
            })
          : await encryptRsaHybrid({
              publicKey: selectedKey.publicKey as CryptoKey,
              recipientKeyId: selectedKey.id,
              plaintext: plaintextData,
              now,
            })
      const payload = encodeEnvelopeToPayload(envelope)
      if (!payloadFits(payload, preferences.qrErrorCorrection)) {
        throw new AppError("QR_TOO_LARGE")
      }
      setResult({ payload, envelope, key: selectedKey })
      setQrName(`暗号文-${formatSuggestedDate(now)}`)
      try {
        await markKeyUsed(selectedKey.id, now)
      } catch {
        setError("暗号化は完了しましたが、鍵の使用記録を更新できませんでした。")
      }
      if (preferences.autoClearPlaintextAfterEncrypt) {
        setPlaintext("")
        toast.info("設定に従って平文を消去しました")
      }
    } catch (caught: unknown) {
      setResult(null)
      setError(toAppError(caught, "ENCRYPTION_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const handleDecrypt = async () => {
    if (!parsedMessage || !selectedKey || busy) return
    setBusy(true)
    setError(null)
    setDecryptedText("")
    try {
      const decrypted =
        "keyId" in parsedMessage
          ? await decryptWithAesKey({
              key: selectedKey.symmetricKey as CryptoKey,
              envelope: parsedMessage,
            })
          : await decryptRsaHybrid({
              privateKey: selectedKey.privateKey as CryptoKey,
              envelope: parsedMessage,
            })
      const completePlaintext = bytesToUtf8(decrypted)
      setDecryptedText(completePlaintext)
      try {
        await markKeyUsed(selectedKey.id, Date.now())
      } catch {
        setError("復号は完了しましたが、鍵の使用記録を更新できませんでした。")
      }
    } catch {
      setDecryptedText("")
      setError("復号できませんでした。鍵、暗号方式、または暗号文が一致していません。")
    } finally {
      setBusy(false)
    }
  }

  const makeArtifact = async (): Promise<StoredQrArtifact | null> => {
    if (!result) return null
    const parsedName = qrNameSchema.safeParse(qrName)
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "QR名を確認してください。")
      return null
    }
    const id = generateArtifactId()
    return {
      id,
      name: parsedName.data,
      kind: "ciphertext",
      sensitivity: "confidential",
      algorithm: result.envelope.algorithm,
      payload: result.payload,
      payloadSha256: await payloadSha256Hex(result.payload),
      byteLength: new TextEncoder().encode(result.payload).byteLength,
      createdAt: result.envelope.createdAt,
      keyId: messageKeyId(result.envelope),
    }
  }

  const finishSave = () => {
    setSaved(true)
    setDuplicateArtifact(null)
    toast.success("QRコードを保存しました")
  }

  const handleSave = async () => {
    try {
      const artifact = await makeArtifact()
      if (!artifact) return
      await saveQrArtifact(artifact)
      finishSave()
    } catch (caught: unknown) {
      if (caught instanceof AppError && caught.code === "DUPLICATE_QR") {
        const artifact = await makeArtifact()
        if (artifact) setDuplicateArtifact(artifact)
        return
      }
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const saveDuplicate = async () => {
    if (!duplicateArtifact) return
    try {
      await saveQrArtifact(duplicateArtifact, { allowDuplicate: true })
      finishSave()
    } catch (caught: unknown) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    }
  }

  const exportQr = async (format: "png" | "svg") => {
    if (!result) return
    const parsedName = qrNameSchema.safeParse(qrName)
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "QR名を確認してください。")
      return
    }
    try {
      const id = generateArtifactId()
      const blob =
        format === "png"
          ? await qrPngBlob(result.payload, {
              ecLevel: preferences.qrErrorCorrection,
              size: env.qrRenderSize,
            })
          : await qrSvgBlob(result.payload, {
              ecLevel: preferences.qrErrorCorrection,
            })
      triggerDownload(blob, buildExportFileName(parsedName.data, id, format))
    } catch (caught: unknown) {
      setError(toAppError(caught, "QR_TOO_LARGE").userMessage)
    }
  }

  const copyPayload = async () => {
    if (!result) return
    try {
      await copyTextToClipboard(result.payload)
      toast.success("ペイロードをコピーしました")
    } catch {
      setError("コピーできませんでした。ブラウザーの権限を確認してください。")
    }
  }

  const modeChanged = (value: string) => {
    const nextMode = value === "decrypt" ? "decrypt" : "encrypt"
    setMode(nextMode)
    setError(null)
    setSelectedKeyId("")
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6">
      <h2 className="sr-only">暗号化と復号</h2>
      <Tabs value={mode} onValueChange={modeChanged}>
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="encrypt" className="h-9 cursor-pointer">
            暗号化
          </TabsTrigger>
          <TabsTrigger value="decrypt" className="h-9 cursor-pointer">
            復号
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "encrypt" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="algorithm-select">暗号化方式</Label>
            <Select
              value={algorithm}
              onValueChange={(value) => {
                setAlgorithmOverride(value as UiAlgorithm)
                setSelectedKeyId("")
                setResult(null)
              }}
            >
              <SelectTrigger id="algorithm-select" className="h-11 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A256GCM">{ALGORITHM_LABELS.A256GCM}</SelectItem>
                {env.enableRsa && (
                  <SelectItem value="RSA-HYBRID">
                    {ALGORITHM_LABELS["RSA-HYBRID"]}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <KeySelector
            keys={eligibleKeys}
            value={effectiveSelectedKeyId}
            onChange={setSelectedKeyId}
            loading={keysLoading}
          />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="plaintext">平文</Label>
              <Button
                type="button"
                variant="ghost"
                className="h-11 cursor-pointer px-3 focus-visible:ring-2"
                disabled={!plaintext}
                onClick={() => setPlaintext("")}
              >
                <Eraser aria-hidden="true" />
                平文を消去
              </Button>
            </div>
            <Textarea
              id="plaintext"
              value={plaintext}
              onChange={(event) => setPlaintext(event.target.value)}
              className="min-h-32 resize-y text-base focus-visible:ring-2"
              placeholder="暗号化する文章を入力してください"
              autoComplete="off"
              spellCheck={false}
            />
            <p
              aria-live="polite"
              className={`flex items-center justify-between gap-2 font-mono text-xs tabular-nums ${overPlaintextLimit ? "text-destructive" : "text-muted-foreground"}`}
            >
              <span>{plaintext.length} 文字</span>
              <span className="flex items-center gap-1">
                {overPlaintextLimit && (
                  <AlertCircle aria-hidden="true" className="size-4" />
                )}
                {plaintextBytes} / {env.maxPlaintextBytes} bytes
              </span>
            </p>
            {overPlaintextLimit && (
              <Alert variant="destructive" role="alert">
                <AlertCircle aria-hidden="true" className="size-4" />
                <AlertTitle>平文の上限を超えています</AlertTitle>
                <AlertDescription>
                  UTF-8で{env.maxPlaintextBytes}バイト以内に短くしてください。
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div aria-live="polite" className="rounded-lg border bg-muted/50 p-3 text-sm">
            <p className="font-mono tabular-nums">
              予想ペイロード: 約 {estimatedPayload} 文字 / EC=
              {preferences.qrErrorCorrection} 上限{" "}
              {qrByteCapacity(preferences.qrErrorCorrection)}
            </p>
            {!estimatedFits && (
              <p className="mt-2 flex gap-2 text-destructive" role="alert">
                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                QRコードに収まらない見込みです。入力を短くしてください。
              </p>
            )}
          </div>

          <Button
            type="button"
            className="h-11 w-full cursor-pointer focus-visible:ring-2"
            disabled={!canEncrypt}
            onClick={() => void handleEncrypt()}
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Lock aria-hidden="true" />
            )}
            {busy ? "暗号化中…" : "暗号化する"}
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full cursor-pointer focus-visible:ring-2"
              disabled={!camera}
              onClick={() => setScannerOpen(true)}
            >
              <ScanLine aria-hidden="true" />
              QRを読み取る
            </Button>
            {!camera && (
              <p className="flex gap-2 text-sm text-muted-foreground">
                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                この端末ではカメラを利用できません。ペイロードを貼り付けてください。
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="decrypt-payload">暗号文ペイロード</Label>
              <Textarea
                id="decrypt-payload"
                value={decryptInput}
                onChange={(event) => {
                  setDecryptInput(event.target.value)
                  setDecryptedText("")
                  setError(null)
                }}
                className="min-h-28 break-all font-mono text-base focus-visible:ring-2"
                placeholder="OCM1: で始まるペイロードを貼り付けてください"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          {decryptInputInvalid && (
            <Alert variant="destructive" role="alert">
              <AlertCircle aria-hidden="true" className="size-4" />
              <AlertTitle>暗号文を確認できません</AlertTitle>
              <AlertDescription>
                OCM1:で始まる本アプリの暗号文ペイロードを入力してください。
              </AlertDescription>
            </Alert>
          )}

          {parsedMessage && (
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-base">読取内容の確認</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 p-4 pt-0 text-sm">
                <DetailRow label="種別" value="暗号文" />
                <DetailRow
                  label="方式"
                  value={ALGORITHM_LABELS[toUiAlgorithm(parsedMessage.algorithm)]}
                />
                <DetailRow label="鍵ID" value={messageKeyId(parsedMessage)} mono />
                <DetailRow
                  label="作成日時"
                  value={formatDateTime(parsedMessage.createdAt)}
                />
              </CardContent>
            </Card>
          )}

          {parsedMessage && !matchedKey && (
            <Alert variant="destructive" role="alert">
              <AlertCircle aria-hidden="true" className="size-4" />
              <AlertTitle>KEY_NOT_FOUND</AlertTitle>
              <AlertDescription>
                この暗号文に対応する鍵が見つかりません(鍵ID:{" "}
                {shortTechnicalId(messageKeyId(parsedMessage))})
              </AlertDescription>
            </Alert>
          )}

          <KeySelector
            keys={eligibleKeys}
            value={effectiveSelectedKeyId}
            onChange={setSelectedKeyId}
            loading={keysLoading}
          />

          <Button
            type="button"
            className="h-11 w-full cursor-pointer focus-visible:ring-2"
            disabled={!parsedMessage || !selectedKey || busy}
            onClick={() => void handleDecrypt()}
          >
            {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {busy ? "復号中…" : "復号する"}
          </Button>

          {decryptedText && (
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                  復号結果
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                <p className="select-text whitespace-pre-wrap break-words rounded-md border bg-background p-3 text-sm leading-relaxed">
                  {decryptedText}
                </p>
                <p className="text-xs text-muted-foreground">
                  復号結果はメモリー内だけに保持し、保存しません。
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 w-full cursor-pointer focus-visible:ring-2"
                  onClick={() => setDecryptedText("")}
                >
                  <Eraser aria-hidden="true" />
                  平文を消去
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {(keysError || preferencesError || error) && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>操作を完了できません</AlertTitle>
          <AlertDescription>{error ?? keysError ?? preferencesError}</AlertDescription>
        </Alert>
      )}
      <p aria-live="polite" className="sr-only">
        {clearStatus}
      </p>

      {result && mode === "encrypt" && (
        <section aria-label="暗号結果" className="space-y-5">
          <Card>
            <CardHeader className="p-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                暗号化が完了しました
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-0">
              <p className="max-h-24 overflow-y-auto break-all rounded-md border bg-background p-3 font-mono text-xs">
                {result.payload}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-11 cursor-pointer focus-visible:ring-2"
                onClick={() => void copyPayload()}
              >
                <Clipboard aria-hidden="true" />
                ペイロードをコピー
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold">暗号文QR</h2>
            <QrDisplay
              payload={result.payload}
              ecLevel={preferences.qrErrorCorrection}
              size={env.qrRenderSize}
              title="暗号文QR"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ciphertext-qr-name">QR名</Label>
            <Input
              id="ciphertext-qr-name"
              value={qrName}
              onChange={(event) => setQrName(event.target.value)}
              className="h-11 text-base focus-visible:ring-2"
              maxLength={80}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              className="h-11 cursor-pointer focus-visible:ring-2"
              onClick={() => void handleSave()}
            >
              <Save aria-hidden="true" />
              保存
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 cursor-pointer focus-visible:ring-2"
              onClick={() => void exportQr("png")}
            >
              <Download aria-hidden="true" />
              PNG
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 cursor-pointer focus-visible:ring-2"
              onClick={() => void exportQr("svg")}
            >
              <FileCode2 aria-hidden="true" />
              SVG
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 cursor-pointer focus-visible:ring-2"
              onClick={() => void copyPayload()}
            >
              <Clipboard aria-hidden="true" />
              コピー
            </Button>
          </div>
          {saved && (
            <p className="flex items-center gap-2 text-sm text-success" role="status">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              保存しました。
              <Link to="/saved" className="underline">
                保存済みを開く
              </Link>
            </p>
          )}

          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full cursor-pointer justify-between focus-visible:ring-2"
              >
                詳細
                <ChevronDown
                  aria-hidden="true"
                  className={
                    detailsOpen
                      ? "rotate-180 transition-transform"
                      : "transition-transform"
                  }
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card>
                <CardContent className="grid gap-2 p-4 text-sm">
                  <DetailRow
                    label="アルゴリズム"
                    value={ALGORITHM_LABELS[toUiAlgorithm(result.envelope.algorithm)]}
                  />
                  <DetailRow label="鍵ID" value={messageKeyId(result.envelope)} mono />
                  <DetailRow
                    label="鍵指紋"
                    value={formatFingerprint(result.key.fingerprint)}
                    mono
                  />
                  <DetailRow
                    label="作成日時"
                    value={formatDateTime(result.envelope.createdAt)}
                  />
                  <DetailRow
                    label="IV(hex)"
                    value={bytesToHex(result.envelope.iv)}
                    mono
                  />
                  <DetailRow
                    label="暗号文サイズ"
                    value={`${messageCiphertextBytes(result.envelope)} bytes`}
                    mono
                  />
                  <DetailRow
                    label="AAD内容"
                    value={bytesToUtf8(result.envelope.aad)}
                    mono
                  />
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        </section>
      )}

      <QrScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        target="message"
        cameraAvailable={camera}
        onScan={(payload) => {
          setDecryptInput(payload)
          setError(null)
          setDecryptedText("")
        }}
      />

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
              別の名前とIDで重複保存しますか。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => void saveDuplicate()}>
              重複して保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function KeySelector({
  keys,
  value,
  onChange,
  loading,
}: {
  keys: StoredKeyRecord[]
  value: string
  onChange: (value: string) => void
  loading: boolean
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="key-select">使用鍵</Label>
      {keys.length > 0 ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id="key-select" className="h-11 text-base">
            <SelectValue
              placeholder={loading ? "鍵を読み込んでいます…" : "鍵を選択してください"}
            />
          </SelectTrigger>
          <SelectContent>
            {keys.map((key) => (
              <SelectItem key={key.id} value={key.id}>
                {key.name} — {formatFingerprint(key.fingerprint).split(" ")[0]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          使用できる鍵がありません。{" "}
          <Link to="/keys" className="font-medium text-primary underline">
            鍵ページで作成してください
          </Link>
        </div>
      )}
    </div>
  )
}

function DetailRow({
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
      <span className={`min-w-0 break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  )
}
