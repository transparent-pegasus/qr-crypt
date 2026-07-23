import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  Eraser,
  FileCode2,
  LoaderCircle,
  Lock,
} from "lucide-react"
import { toast } from "sonner"
import { decryptWithAesKey, encryptWithAesKey } from "@/crypto/aes-gcm"
import { AppError, toAppError, userMessageFor } from "@/crypto/errors"
import type { AesMessageEnvelopeV1 } from "@/crypto/envelope"
import { decodeMlKemEnvelopeV2, encodeMlKemEnvelopeV2 } from "@/crypto/pq/canonical-cbor"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import { encryptPq } from "@/crypto/pq/ml-kem-envelope"
import {
  ACTIVE_PROFILE,
  assertActiveProfile,
  assertActiveSuite,
  resolveSuite,
} from "@/crypto/pq/suites"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { generateArtifactId } from "@/crypto/random"
import {
  useFeatureSupport,
  useSensitiveSession,
  useTransientClear,
} from "@/app/providers"
import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import { QrDisplay } from "@/components/qr-display"
import { QrScannerPanel } from "@/components/qr-scanner-panel"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { MultipartScanSession } from "@/features/multipart-scan-session"
import {
  ALGORITHM_LABELS,
  formatDateTime,
  formatSuggestedDate,
} from "@/features/presentation"
import { useAutoClear } from "@/hooks/use-auto-clear"
import { useKeys } from "@/hooks/use-keys"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePqRecords } from "@/hooks/use-pq-records"
import { usePreferences } from "@/hooks/use-preferences"
import { bytesToUtf8, sha256Hex, utf8ToBytes } from "@/lib/bytes"
import { ecLevelFor, payloadFits } from "@/qr/encode"
import {
  buildExportFileName,
  copyTextToClipboard,
  qrPngBlob,
  qrSvgBlob,
  triggerDownload,
} from "@/qr/export-image"
import { splitIntoFrames } from "@/qr/multipart/split"
import { buildV2Payload } from "@/qr/payload-v2"
import { decodePayload, encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"
import type {
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
  PqPublicBundleRecord,
  QrFrameV2,
  StoredKeyRecord,
  UiAlgorithm,
  WireSuite,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { qrNameSchema } from "@/schemas/key-schema"
import { markKeyUsed } from "@/storage/key-repository"
import { markBundleUsed } from "@/storage/pq-bundle-repository"
import { markIdentityUsed } from "@/storage/pq-identity-repository"

type PageMode = "encrypt" | "decrypt"

type EncryptionResult =
  | {
      kind: "aes"
      payload: string
      envelope: AesMessageEnvelopeV1
      key: StoredKeyRecord
      createdAt: number
      totalBytes: number
      sha256: string
    }
  | {
      kind: "pq"
      payload: string
      envelope: MlKemMessageEnvelopeV2
      frames: QrFrameV2[]
      recipient: PqPublicBundleRecord
      sender?: PostQuantumIdentity
      createdAt: number
      totalBytes: number
      sha256: string
    }

type DecryptionResult =
  | { kind: "unsigned"; text: string }
  | {
      kind: "signed-valid"
      text: string
      senderSigningKeyId: string
      sender: PqPublicBundleRecord | undefined
    }
  | { kind: "signed-key-unknown"; senderSigningKeyId: string }
  | { kind: "aes"; text: string }

function algorithmOptions(requireSignature: boolean): UiAlgorithm[] {
  const options: UiAlgorithm[] = ["A256GCM"]
  if (env.enableMlKem && !requireSignature) options.push("MLKEM1024_A256GCM")
  if (env.enableMlKem && env.enableMlDsa) {
    options.push("MLKEM1024_MLDSA87_A256GCM")
  }
  return options
}

function isSignedAlgorithm(algorithm: UiAlgorithm): boolean {
  return algorithm === "MLKEM1024_MLDSA87_A256GCM"
}

function isActiveBundle(record: PqPublicBundleRecord): boolean {
  try {
    assertActiveSuite(resolveSuite(record.kem.algorithm, record.signing.algorithm))
    return true
  } catch {
    return false
  }
}

function isActiveIdentity(identity: PostQuantumIdentity): boolean {
  try {
    assertActiveProfile(identity.profile)
    assertActiveSuite(resolveSuite(identity.kem.algorithm, identity.signing.algorithm))
    return true
  } catch {
    return false
  }
}

function isActiveWireSuite(suite: WireSuite): boolean {
  try {
    assertActiveSuite(suite)
    return true
  } catch {
    return false
  }
}

export function EncryptPage() {
  const { keys, loading: keysLoading, error: keysError } = useKeys()
  const {
    identities,
    bundles,
    loading: pqLoading,
    error: pqError,
    refresh: refreshPq,
  } = usePqRecords()
  const { preferences, error: preferencesError } = usePreferences()
  const getPqClient = usePqCryptoClient()
  const { camera } = useFeatureSupport()
  const { nonce } = useTransientClear()
  const { setSensitiveSession, resetSensitiveSession } = useSensitiveSession()
  const [mode, setMode] = useState<PageMode>("encrypt")
  const [algorithmOverride, setAlgorithmOverride] = useState<UiAlgorithm | null>(null)
  const [selectedKeyId, setSelectedKeyId] = useState("")
  const [recipientRecordId, setRecipientRecordId] = useState("")
  const [senderIdentityId, setSenderIdentityId] = useState("")
  const [plaintext, setPlaintext] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EncryptionResult | null>(null)
  const [outputName, setOutputName] = useState("")
  const [decryptInput, setDecryptInput] = useState("")
  const [decrypted, setDecrypted] = useState<DecryptionResult | null>(null)
  const [clearStatus, setClearStatus] = useState("")

  const algorithms = useMemo(
    () => algorithmOptions(preferences.requireSignature),
    [preferences.requireSignature],
  )
  const algorithm = algorithms.includes(algorithmOverride as UiAlgorithm)
    ? (algorithmOverride as UiAlgorithm)
    : algorithms.includes(preferences.defaultAlgorithm)
      ? preferences.defaultAlgorithm
      : (algorithms.at(-1) ?? "A256GCM")
  const signed = isSignedAlgorithm(algorithm)
  const symmetricKeys = useMemo(
    () =>
      keys.filter((key) => key.kind === "symmetric" && key.symmetricKey !== undefined),
    [keys],
  )
  const selectedKey = symmetricKeys.find((key) => key.id === selectedKeyId)
  const recipients = useMemo(
    () =>
      bundles.filter(
        (record) => record.revokedAt === undefined && isActiveBundle(record),
      ),
    [bundles],
  )
  const selectedRecipient = recipients.find(
    (record) => record.recordId === recipientRecordId,
  )
  const signingIdentities = useMemo(
    () =>
      identities.filter((identity) => {
        if (identity.status !== "active") return false
        if (!isActiveIdentity(identity)) return false
        if (!selectedRecipient) return identity.profile === ACTIVE_PROFILE
        try {
          assertActiveSuite(
            resolveSuite(selectedRecipient.kem.algorithm, identity.signing.algorithm),
          )
          return true
        } catch {
          return false
        }
      }),
    [identities, selectedRecipient],
  )
  const selectedSender = signingIdentities.find(
    (identity) => identity.id === senderIdentityId,
  )
  const plaintextBytes = useMemo(() => utf8ToBytes(plaintext), [plaintext])
  const overPlaintextLimit = plaintextBytes.byteLength > env.maxPlaintextBytes
  const canEncrypt =
    plaintext.length > 0 &&
    !overPlaintextLimit &&
    !busy &&
    (algorithm === "A256GCM"
      ? selectedKey !== undefined
      : selectedRecipient !== undefined && (!signed || selectedSender !== undefined))

  const multipartSession = useMemo(
    () => new MultipartScanSession(preferences.transferTimeoutMinutes),
    [preferences.transferTimeoutMinutes],
  )

  const parsedDecrypt = useMemo(() => {
    const input = decryptInput.trim()
    if (!input) return null
    try {
      const decoded = decodePayload(input)
      return decoded.kind === "message" || decoded.kind === "pq-message" ? decoded : null
    } catch {
      return null
    }
  }, [decryptInput])
  const decryptInputInvalid = decryptInput.trim().length > 0 && parsedDecrypt === null
  const parsedPqUnsupported =
    parsedDecrypt?.kind === "pq-message" &&
    !isActiveWireSuite(parsedDecrypt.envelope.suite)
  const decryptAesKey =
    parsedDecrypt?.kind === "message"
      ? symmetricKeys.find((key) => key.id === parsedDecrypt.envelope.keyId)
      : undefined
  const decryptIdentity =
    parsedDecrypt?.kind === "pq-message"
      ? identities.find(
          (identity) =>
            identity.kem.keyId === parsedDecrypt.envelope.recipientKemKeyId &&
            isActiveIdentity(identity),
        )
      : undefined
  const canDecrypt =
    !busy &&
    parsedDecrypt !== null &&
    !parsedPqUnsupported &&
    (parsedDecrypt.kind === "message"
      ? decryptAesKey !== undefined
      : decryptIdentity !== undefined)

  useEffect(() => {
    setSensitiveSession({
      hasPlaintext: plaintext.length > 0,
      hasDecrypted: decrypted !== null && decrypted.kind !== "signed-key-unknown",
      cryptoBusy: busy,
      secretVisible: false,
    })
  }, [busy, decrypted, plaintext, setSensitiveSession])
  useEffect(() => () => resetSensitiveSession(), [resetSensitiveSession])

  const clearTransient = useCallback(() => {
    setPlaintext("")
    setDecryptInput("")
    setDecrypted(null)
    setResult(null)
    setOutputName("")
    setError(null)
    multipartSession.discard()
    setClearStatus("自動消去しました")
    toast.info("自動消去しました")
  }, [multipartSession])

  useAutoClear({
    enabled: preferences.backgroundClearEnabled,
    onClear: clearTransient,
    clearNonce: nonce,
  })

  const handleEncrypt = async () => {
    if (!canEncrypt) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const now = Date.now()
      if (algorithm === "A256GCM" && selectedKey?.symmetricKey) {
        const envelope = await encryptWithAesKey({
          key: selectedKey.symmetricKey,
          keyId: selectedKey.id,
          plaintext: plaintextBytes,
          now,
        })
        const payload = encodeEnvelopeToPayload(envelope)
        if (!payloadFits(payload, ecLevelFor("message", preferences))) {
          throw new AppError("QR_TOO_LARGE")
        }
        setResult({
          kind: "aes",
          payload,
          envelope,
          key: selectedKey,
          createdAt: now,
          totalBytes: new TextEncoder().encode(payload).byteLength,
          sha256: await payloadSha256Hex(payload),
        })
        await markKeyUsed(selectedKey.id, now).catch(() => undefined)
      } else if (selectedRecipient) {
        const sender = signed ? selectedSender : undefined
        if (signed && sender === undefined) throw new AppError("KEY_NOT_FOUND")
        const envelope = await encryptPq({
          client: getPqClient(),
          recipient: selectedRecipient,
          plaintext: plaintextBytes,
          ...(sender === undefined
            ? {}
            : { sign: { identity: sender, vaultKey: await getOrCreateVaultKey() } }),
          now,
        })
        const artifactBytes = encodeMlKemEnvelopeV2(envelope)
        const frames = await splitIntoFrames({
          artifactType: "pq-message",
          artifactBytes,
          frameBytes: preferences.frameBytes,
        })
        setResult({
          kind: "pq",
          payload: buildV2Payload("pq-message", artifactBytes),
          envelope,
          frames,
          recipient: selectedRecipient,
          ...(sender === undefined ? {} : { sender }),
          createdAt: now,
          totalBytes: artifactBytes.byteLength,
          sha256: await sha256Hex(artifactBytes),
        })
        await markBundleUsed(selectedRecipient.recordId, now).catch(() => undefined)
        if (sender) await markIdentityUsed(sender.id, now).catch(() => undefined)
      }
      setOutputName(`暗号結果-${formatSuggestedDate(now)}`)
      if (preferences.autoClearPlaintextAfterEncrypt) {
        setPlaintext("")
        toast.info("設定に従って平文を消去しました")
      }
      await refreshPq()
    } catch (caught) {
      setError(toAppError(caught, "ENCRYPTION_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const handleDecrypt = async () => {
    if (!canDecrypt || parsedDecrypt === null) return
    setBusy(true)
    setError(null)
    setDecrypted(null)
    try {
      if (parsedDecrypt.kind === "message" && decryptAesKey?.symmetricKey) {
        const plaintextResult = await decryptWithAesKey({
          key: decryptAesKey.symmetricKey,
          envelope: parsedDecrypt.envelope,
        })
        setDecrypted({ kind: "aes", text: bytesToUtf8(plaintextResult) })
        await markKeyUsed(decryptAesKey.id, Date.now()).catch(() => undefined)
      } else if (parsedDecrypt.kind === "pq-message" && decryptIdentity) {
        const pqResult = await decryptPqMessage({
          client: getPqClient(),
          envelope: parsedDecrypt.envelope,
          recipient: decryptIdentity,
          vaultKey: await getOrCreateVaultKey(),
          resolveSigningKey: async (keyId) => {
            const record = bundles.find(
              (bundle) => bundle.signing.keyId === keyId && isActiveBundle(bundle),
            )
            return record === undefined
              ? undefined
              : {
                  algorithm: record.signing.algorithm,
                  publicKey: record.signing.publicKey,
                  revoked: record.revokedAt !== undefined,
                }
          },
        })
        if (pqResult.kind === "signed-key-unknown") {
          setDecrypted(pqResult)
        } else if (pqResult.kind === "unsigned") {
          setDecrypted({ kind: "unsigned", text: bytesToUtf8(pqResult.plaintext) })
        } else {
          setDecrypted({
            kind: "signed-valid",
            text: bytesToUtf8(pqResult.plaintext),
            senderSigningKeyId: pqResult.senderSigningKeyId,
            sender: bundles.find(
              (bundle) =>
                bundle.signing.keyId === pqResult.senderSigningKeyId &&
                isActiveBundle(bundle),
            ),
          })
        }
        await markIdentityUsed(decryptIdentity.id, Date.now()).catch(() => undefined)
      }
    } catch (caught) {
      setDecrypted(null)
      setError(toAppError(caught, "DECRYPTION_FAILED").userMessage)
    } finally {
      setBusy(false)
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

  const exportSingle = async (format: "png" | "svg") => {
    if (result?.kind !== "aes") return
    const parsedName = qrNameSchema.safeParse(outputName)
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "出力名を確認してください。")
      return
    }
    try {
      const id = generateArtifactId()
      const ecLevel = ecLevelFor("message", preferences)
      const blob =
        format === "png"
          ? await qrPngBlob(result.payload, { ecLevel, size: env.qrRenderSize })
          : await qrSvgBlob(result.payload, { ecLevel })
      triggerDownload(blob, buildExportFileName(parsedName.data, id, format))
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").userMessage)
    }
  }

  const resultSuite: WireSuite | "A256GCM" | null =
    result?.kind === "aes" ? "A256GCM" : (result?.envelope.suite ?? null)

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6" aria-busy={busy}>
      <h2 className="sr-only">暗号化と復号</h2>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value === "decrypt" ? "decrypt" : "encrypt")
          setError(null)
        }}
      >
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
                setResult(null)
                setError(null)
              }}
            >
              <SelectTrigger id="algorithm-select" className="h-11 text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {algorithms.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ALGORITHM_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {algorithm === "A256GCM" ? (
            <RecordSelect
              id="key-select"
              label="使用鍵"
              value={selectedKeyId}
              onChange={setSelectedKeyId}
              loading={keysLoading}
              items={symmetricKeys.map((key) => ({ value: key.id, label: key.name }))}
            />
          ) : (
            <>
              <RecordSelect
                id="recipient-select"
                label="受信者のML-KEM公開鍵"
                value={recipientRecordId}
                onChange={setRecipientRecordId}
                loading={pqLoading}
                items={recipients.map((record) => ({
                  value: record.recordId,
                  label: `${record.trust === "fingerprint-confirmed" ? "確認済み" : "未確認"}: ${record.trust === "fingerprint-confirmed" ? (record.name ?? record.kem.keyId) : record.kem.keyId}`,
                }))}
              />
              {signed && (
                <RecordSelect
                  id="sender-select"
                  label="自分のML-DSA署名ID"
                  value={senderIdentityId}
                  onChange={setSenderIdentityId}
                  loading={pqLoading}
                  items={signingIdentities.map((identity) => ({
                    value: identity.id,
                    label: identity.name,
                  }))}
                />
              )}
            </>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="plaintext">平文</Label>
              <Button
                type="button"
                variant="ghost"
                className="h-11 cursor-pointer px-3 focus-visible:ring-2"
                disabled={!plaintext || busy}
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
              disabled={busy}
            />
            <p
              className={`flex justify-between font-mono text-xs ${overPlaintextLimit ? "text-destructive" : "text-muted-foreground"}`}
            >
              <span>{plaintext.length} 文字</span>
              <span>
                {plaintextBytes.byteLength} / {env.maxPlaintextBytes} bytes
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
          <div className="space-y-2">
            <Label htmlFor="decrypt-payload">暗号文ペイロード</Label>
            <Textarea
              id="decrypt-payload"
              value={decryptInput}
              onChange={(event) => {
                setDecryptInput(event.target.value)
                setDecrypted(null)
                setError(null)
              }}
              className="min-h-28 break-all font-mono text-base focus-visible:ring-2"
              placeholder="OCM1: または OCM2: ペイロードを貼り付けてください"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>
          {decryptInputInvalid && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>暗号文を確認できません</AlertTitle>
              <AlertDescription>
                対応するOCM1/OCM2暗号文を入力してください。
              </AlertDescription>
            </Alert>
          )}
          {parsedDecrypt && (
            <Card>
              <CardContent className="space-y-2 p-4 text-sm">
                <DetailRow
                  label="方式"
                  value={
                    parsedDecrypt.kind === "message"
                      ? "A256GCM"
                      : parsedDecrypt.envelope.suite
                  }
                />
                <DetailRow
                  label="受信者鍵ID"
                  value={
                    parsedDecrypt.kind === "message"
                      ? parsedDecrypt.envelope.keyId
                      : parsedDecrypt.envelope.recipientKemKeyId
                  }
                  mono
                />
              </CardContent>
            </Card>
          )}
          {parsedPqUnsupported && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>非対応（旧プロファイル）</AlertTitle>
              <AlertDescription>
                この暗号文は現在利用できない旧ポスト量子プロファイルです。
              </AlertDescription>
            </Alert>
          )}
          {parsedDecrypt && !parsedPqUnsupported && !canDecrypt && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>KEY_NOT_FOUND</AlertTitle>
              <AlertDescription>{userMessageFor("KEY_NOT_FOUND")}</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            className="h-11 w-full cursor-pointer focus-visible:ring-2"
            disabled={!canDecrypt}
            onClick={() => void handleDecrypt()}
          >
            {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
            {busy ? "復号中…" : "復号する"}
          </Button>

          <QrScannerPanel
            singleTargets={["message"]}
            cameraAvailable={camera}
            title="暗号文QRを読み取る"
            onSingleScan={(_target, payload) => {
              setDecryptInput(payload)
              setDecrypted(null)
              setError(null)
            }}
            multipart={{
              session: multipartSession,
              onComplete: ({ artifactType, artifactBytes }) => {
                if (artifactType !== "pq-message")
                  throw new AppError("INVALID_QR_PAYLOAD")
                const envelope = decodeMlKemEnvelopeV2(artifactBytes)
                setDecryptInput(
                  buildV2Payload("pq-message", encodeMlKemEnvelopeV2(envelope)),
                )
                setDecrypted(null)
                setError(null)
              },
            }}
          />

          {decrypted?.kind === "signed-key-unknown" && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>SIGNING_KEY_NOT_FOUND</AlertTitle>
              <AlertDescription>
                {userMessageFor("SIGNING_KEY_NOT_FOUND")} 鍵ID:{" "}
                {decrypted.senderSigningKeyId}
                <br />
                <Link to="/keys" className="font-medium underline">
                  署名鍵を取り込む
                </Link>
              </AlertDescription>
            </Alert>
          )}
          {decrypted && decrypted.kind !== "signed-key-unknown" && (
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                  復号結果
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                {decrypted.kind === "unsigned" && (
                  <p className="text-sm font-medium">署名なし</p>
                )}
                {decrypted.kind === "aes" && (
                  <p className="text-sm font-medium">共通鍵メッセージ、署名なし</p>
                )}
                {decrypted.kind === "signed-valid" && (
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-success">
                      署名はこの鍵に対して有効です
                    </p>
                    <p className="font-mono text-xs break-all">
                      送信者署名鍵ID: {decrypted.senderSigningKeyId}
                    </p>
                    <p>
                      人物確認:{" "}
                      {decrypted.sender?.trust === "fingerprint-confirmed"
                        ? "人物確認済み"
                        : "未確認。鍵の有効性と人物確認は別です。"}
                    </p>
                  </div>
                )}
                <p className="select-text whitespace-pre-wrap break-words rounded-md border p-3 text-sm">
                  {decrypted.text}
                </p>
                <p className="text-xs text-muted-foreground">
                  復号結果はメモリー内だけに保持し、保存しません。
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 w-full cursor-pointer"
                  onClick={() => setDecrypted(null)}
                >
                  <Eraser aria-hidden="true" />
                  平文を消去
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {(keysError || pqError || preferencesError || error) && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>操作を完了できません</AlertTitle>
          <AlertDescription>
            {error ?? keysError ?? pqError ?? preferencesError}
          </AlertDescription>
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
              <p className="max-h-24 overflow-y-auto break-all rounded-md border p-3 font-mono text-xs">
                {result.payload}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-11 cursor-pointer"
                onClick={() => void copyPayload()}
              >
                <Clipboard aria-hidden="true" />
                ペイロードをコピー
              </Button>
            </CardContent>
          </Card>

          {result.kind === "aes" ? (
            <QrDisplay
              payload={result.payload}
              ecLevel={ecLevelFor("message", preferences)}
              size={env.qrRenderSize}
              title="暗号文QR"
            />
          ) : (
            <AnimatedQrFrames
              frames={result.frames}
              frameIntervalMs={preferences.frameIntervalMs}
              outputName={outputName || "pq-message"}
              title="暗号文"
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="output-name">出力名</Label>
            <Input
              id="output-name"
              value={outputName}
              onChange={(event) => setOutputName(event.target.value)}
              maxLength={80}
              className="h-11"
            />
          </div>

          {result.kind === "aes" && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 cursor-pointer"
                onClick={() => void exportSingle("png")}
              >
                <Download aria-hidden="true" />
                PNG
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 cursor-pointer"
                onClick={() => void exportSingle("svg")}
              >
                <FileCode2 aria-hidden="true" />
                SVG
              </Button>
            </div>
          )}

          <Card aria-label="暗号結果詳細">
            <CardHeader className="p-4 pb-3">
              <CardTitle className="text-base">結果詳細</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0 text-sm">
              <DetailRow label="使用暗号スイート" value={resultSuite ?? "なし"} />
              <DetailRow
                label="受信者鍵ID"
                value={
                  result.kind === "aes"
                    ? result.envelope.keyId
                    : result.envelope.recipientKemKeyId
                }
                mono
              />
              <DetailRow
                label="送信者署名鍵ID"
                value={
                  result.kind === "pq" ? (result.sender?.signing.keyId ?? "なし") : "なし"
                }
                mono
              />
              <DetailRow label="総データ量" value={`${result.totalBytes} bytes`} mono />
              <DetailRow
                label="QRフレーム数"
                value={`${result.kind === "pq" ? result.frames.length : 1} 枚`}
                mono
              />
              <DetailRow label="暗号化日時" value={formatDateTime(result.createdAt)} />
              <DetailRow
                label="署名"
                value={result.kind === "pq" && result.sender ? "あり" : "なし"}
              />
              <DetailRow
                label="ポスト量子プロファイル"
                value={result.kind === "pq" ? ACTIVE_PROFILE : "対象外"}
              />
              <DetailRow label="全体SHA-256" value={result.sha256} mono />
            </CardContent>
          </Card>
        </section>
      )}

    </section>
  )
}

function RecordSelect({
  id,
  label,
  value,
  onChange,
  loading,
  items,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  loading: boolean
  items: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {items.length > 0 ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="h-11 text-base">
            <SelectValue placeholder={loading ? "読み込み中…" : "選択してください"} />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          使用できる鍵がありません。{" "}
          <Link to="/keys" className="font-medium text-primary underline">
            鍵ページを開く
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
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`min-w-0 break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  )
}
