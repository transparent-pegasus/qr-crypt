import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  Eraser,
  LoaderCircle,
  Lock,
} from "lucide-react"
import { toast } from "sonner"
import { AppError, toAppError } from "@/crypto/errors"
import { groupSymmetricKeys } from "@/crypto/key-generation"
import { isUsableBundle, isUsableIdentity } from "@/crypto/pq/identity-policy"
import { ACTIVE_PROFILE, assertActiveSuite, resolveSuite } from "@/crypto/pq/suites"
import { generateArtifactId, shortId } from "@/crypto/random"
import { useSensitiveSession, useTransientClear } from "@/app/providers"
import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import { DetailRow } from "@/components/detail-row"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { QrDisplay } from "@/components/qr-display"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  encryptMessage,
  type EncryptedMessage,
  type EncryptMessageRequest,
} from "@/features/encrypt-message"
import {
  ALGORITHM_LABELS,
  formatDateTime,
  formatSuggestedDate,
} from "@/features/presentation"
import { useAutoClear } from "@/hooks/use-auto-clear"
import { useCompatibilityMode } from "@/hooks/use-compatibility-mode"
import { useKeys } from "@/hooks/use-keys"
import { useFrameSplit } from "@/hooks/use-frame-split"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePqRecords } from "@/hooks/use-pq-records"
import { usePreferences } from "@/hooks/use-preferences"
import {
  messageKeyOrFallback,
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"
import { utf8ToBytes } from "@/lib/bytes"
import { effectiveGeneratedDisplay } from "@/lib/generated-display"
import { MAX_SYM_PLAINTEXT_BYTES } from "@/lib/limits"
import { copyTextToClipboard } from "@/qr/export-image"
import { exportQrFramePayloads } from "@/qr/export-frames"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import { type UiAlgorithm } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { qrNameSchema } from "@/schemas/key-schema"

// The generation is the page's own: it distinguishes the result currently on screen
// from one a later encryption superseded while an export was still running.
type EncryptionResult = EncryptedMessage & { generation: number }

const EMPTY_ARTIFACT_BYTES = new Uint8Array()

function algorithmOptions(): UiAlgorithm[] {
  const options: UiAlgorithm[] = ["A256GCM"]
  if (env.enableMlKem && env.enableMlDsa) {
    options.push("MLKEM1024_MLDSA87_A256GCM")
  }
  return options
}

export function EncryptPage() {
  const { language, t } = useI18n()
  const { keys, loading: keysLoading, error: keysError } = useKeys()
  const {
    identities,
    bundles,
    loading: pqLoading,
    error: pqError,
    refresh: refreshPq,
  } = usePqRecords()
  const {
    preferences,
    loading: preferencesLoading,
    error: preferencesError,
    updatePreferences,
  } = usePreferences()
  const {
    updating: compatibilityUpdating,
    error: compatibilityError,
    change: changeCompatibilityMode,
    reset: resetCompatibilityMode,
  } = useCompatibilityMode({ updatePreferences, active: true })
  const getPqClient = usePqCryptoClient()
  const { nonce } = useTransientClear()
  const { setSensitiveSession, resetSensitiveSession } = useSensitiveSession()
  const [algorithmOverride, setAlgorithmOverride] = useState<UiAlgorithm | null>(null)
  const [selectedKeyId, setSelectedKeyId] = useState("")
  const [recipientRecordId, setRecipientRecordId] = useState("")
  const [senderIdentityId, setSenderIdentityId] = useState("")
  const [plaintext, setPlaintext] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(
    error ?? keysError ?? pqError ?? preferencesError,
  )
  const localizedCompatibilityError = useLocalizedMessage(compatibilityError)
  const [result, setResult] = useState<EncryptionResult | null>(null)
  const [resultExporting, setResultExporting] = useState(false)
  const [resultError, setResultError] = useState<LocalizedMessage | null>(null)
  const localizedResultError = useLocalizedMessage(resultError)
  const [outputName, setOutputName] = useState("")
  const [clearStatus, setClearStatus] = useState<"encrypt.toast.autoCleared" | null>(null)
  const resultGenerationRef = useRef(0)
  const resultAbortRef = useRef<AbortController | null>(null)
  const frameProfile = effectiveGeneratedDisplay(
    preferences,
    result?.kind === "pq" ? result.artifactBytes.byteLength : null,
  )
  const resultFrameBytes =
    result?.kind === "sym" ? result.frameBytes : frameProfile.frameBytes
  const frameSplit = useFrameSplit({
    bytes: result?.artifactBytes ?? EMPTY_ARTIFACT_BYTES,
    artifactType: result?.artifactType ?? "pq-message",
    frameBytes: resultFrameBytes,
    enabled: result !== null,
    generation: `${result?.generation ?? 0}:${resultFrameBytes}`,
  })
  const symmetricFrameInvariantFailed =
    result?.kind === "sym" && frameSplit.frames.length > 1
  const frameError = symmetricFrameInvariantFailed ? "QR_TOO_LARGE" : frameSplit.error
  const frames = useMemo(
    () =>
      [...(symmetricFrameInvariantFailed ? [] : frameSplit.frames)]
        .sort((left, right) => left.frameIndex - right.frameIndex)
        .map((frame) => ({
          frameIndex: frame.frameIndex,
          payload: encodeFrameToPayload(frame),
        })),
    [frameSplit.frames, symmetricFrameInvariantFailed],
  )
  const canExportResult =
    frames.length > 0 && !frameSplit.splitting && frameError === null
  const localizedFrameError = useLocalizedMessage(frameError)

  const algorithms = useMemo(() => algorithmOptions(), [])
  const algorithm = algorithms.includes(algorithmOverride as UiAlgorithm)
    ? (algorithmOverride as UiAlgorithm)
    : algorithms.includes(preferences.defaultAlgorithm)
      ? preferences.defaultAlgorithm
      : (algorithms.at(-1) ?? "A256GCM")
  const symmetricKeys = useMemo(
    () => groupSymmetricKeys(keys).map((group) => group.head),
    [keys],
  )
  const selectedKey = symmetricKeys.find((key) => key.id === selectedKeyId)
  const recipients = useMemo(
    () =>
      bundles.filter(
        (record) =>
          record.revokedAt === undefined &&
          isUsableBundle(record) &&
          // An in-band check the sender can forge is not an identity proof. Only a
          // fingerprint compared out of band may authorise encryption to this key.
          record.trust === "fingerprint-confirmed",
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
        if (!isUsableIdentity(identity)) return false
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
  const plaintextLimitBytes =
    algorithm === "A256GCM" ? MAX_SYM_PLAINTEXT_BYTES : env.maxPlaintextBytes
  const overPlaintextLimit = plaintextBytes.byteLength > plaintextLimitBytes
  const canEncrypt =
    plaintext.length > 0 &&
    !overPlaintextLimit &&
    !busy &&
    (algorithm === "A256GCM"
      ? selectedKey !== undefined
      : selectedRecipient !== undefined && selectedSender !== undefined)

  useEffect(() => {
    setSensitiveSession({
      hasPlaintext: plaintext.length > 0,
      cryptoBusy: busy,
      secretVisible: false,
    })
  }, [busy, plaintext, setSensitiveSession])
  useEffect(
    () => () => {
      resultAbortRef.current?.abort()
      resultAbortRef.current = null
      resetCompatibilityMode()
      resetSensitiveSession()
    },
    [resetCompatibilityMode, resetSensitiveSession],
  )

  const clearTransient = useCallback(() => {
    resultAbortRef.current?.abort()
    resultAbortRef.current = null
    resetCompatibilityMode()
    setResultExporting(false)
    setPlaintext("")
    setResult(null)
    setOutputName("")
    setError(null)
    setResultError(null)
    setClearStatus("encrypt.toast.autoCleared")
    toast.info(t("encrypt.toast.autoCleared"))
  }, [resetCompatibilityMode, t])

  useAutoClear({
    enabled: preferences.backgroundClearEnabled,
    onClear: clearTransient,
    clearNonce: nonce,
  })

  const handleEncrypt = async () => {
    if (!canEncrypt) return
    resultAbortRef.current?.abort()
    resultAbortRef.current = null
    resetCompatibilityMode()
    setResultExporting(false)
    setResultError(null)
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const now = Date.now()
      let request: EncryptMessageRequest | null = null
      if (algorithm === "A256GCM" && selectedKey?.symmetricKey) {
        request = { kind: "sym", record: selectedKey, plaintext: plaintextBytes, now }
      } else if (selectedRecipient) {
        if (selectedSender === undefined) throw new AppError("KEY_NOT_FOUND")
        request = {
          kind: "pq",
          client: getPqClient(),
          recipient: selectedRecipient,
          sender: selectedSender,
          plaintext: plaintextBytes,
          now,
        }
      }
      if (request !== null) {
        const message = await encryptMessage(request)
        resultGenerationRef.current += 1
        setOutputName(
          t("encrypt.output.suggestedName", { date: formatSuggestedDate(now) }),
        )
        setResult({ ...message, generation: resultGenerationRef.current })
      }
      if (preferences.autoClearPlaintextAfterEncrypt) {
        setPlaintext("")
        toast.info(t("encrypt.toast.plaintextClearedByPref"))
      }
      await refreshPq()
    } catch (caught) {
      setError(toAppError(caught, "ENCRYPTION_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const copyPayload = async () => {
    if (!result) return
    const controller = resultAbortRef.current ?? new AbortController()
    resultAbortRef.current = controller
    const { signal } = controller
    try {
      await copyTextToClipboard(result.payload)
      if (signal.aborted) return
      toast.success(t("encrypt.toast.payloadCopied"))
    } catch {
      if (signal.aborted) return
      setResultError("common.copyFailed")
    }
  }

  const exportFrames = async () => {
    if (result === null || resultExporting || !canExportResult) return
    const controller = resultAbortRef.current ?? new AbortController()
    resultAbortRef.current = controller
    const { signal } = controller
    const parsedName = qrNameSchema.safeParse(outputName)
    if (!parsedName.success) {
      setResultError(
        messageKeyOrFallback(
          parsedName.error.issues[0]?.message,
          "encrypt.validation.outputNameFallback",
        ),
      )
      return
    }
    setResultExporting(true)
    setResultError(null)
    try {
      const exportOutputName =
        result.kind === "sym"
          ? `${parsedName.data}-${shortId(generateArtifactId())}`
          : parsedName.data
      await exportQrFramePayloads(frames, {
        outputName: exportOutputName,
        size: env.qrRenderSize,
        signal,
      })
      if (signal.aborted) return
    } catch (caught) {
      if (signal.aborted) return
      setResultError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      if (!signal.aborted) setResultExporting(false)
    }
  }

  const resultSuite = result?.envelope.suite ?? null

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6" aria-busy={busy}>
      <h2 className="sr-only">{t("encrypt.srHeading")}</h2>

      <div className="space-y-2">
        <Label htmlFor="algorithm-select">{t("encrypt.algorithmLabel")}</Label>
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
                {ALGORITHM_LABELS[language][option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {algorithm === "A256GCM" ? (
        <RecordSelect
          id="key-select"
          label={t("encrypt.keyLabel")}
          value={selectedKeyId}
          onChange={setSelectedKeyId}
          loading={keysLoading}
          items={symmetricKeys.map((key) => ({ value: key.id, label: key.name }))}
        />
      ) : (
        <>
          <RecordSelect
            id="recipient-select"
            label={t("encrypt.recipientLabel")}
            value={recipientRecordId}
            onChange={setRecipientRecordId}
            loading={pqLoading}
            items={recipients.map((record) => ({
              value: record.recordId,
              label: `${t("encrypt.recipient.confirmed")}: ${record.name ?? record.kem.keyId}`,
            }))}
          />
          {!pqLoading && recipients.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("encrypt.recipient.needsConfirmation")}
            </p>
          )}
          <RecordSelect
            id="sender-select"
            label={t("encrypt.senderLabel")}
            value={senderIdentityId}
            onChange={setSenderIdentityId}
            loading={pqLoading}
            items={signingIdentities.map((identity) => ({
              value: identity.id,
              label: identity.name,
            }))}
          />
        </>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="plaintext">{t("encrypt.plaintextLabel")}</Label>
          <Button
            type="button"
            variant="ghost"
            className="h-11 cursor-pointer px-3 focus-visible:ring-2"
            disabled={!plaintext || busy}
            onClick={() => setPlaintext("")}
          >
            <Eraser aria-hidden="true" />
            {t("encrypt.clearPlaintext")}
          </Button>
        </div>
        <Textarea
          id="plaintext"
          value={plaintext}
          onChange={(event) => setPlaintext(event.target.value)}
          className="min-h-32 resize-y text-base focus-visible:ring-2"
          placeholder={t("encrypt.plaintextPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <p
          className={`flex justify-between font-mono text-xs ${overPlaintextLimit ? "text-destructive" : "text-muted-foreground"}`}
        >
          <span>{t("encrypt.charCount", { count: plaintext.length })}</span>
          <span>
            {plaintextBytes.byteLength} / {plaintextLimitBytes} bytes
          </span>
        </p>
        {overPlaintextLimit && (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden="true" className="size-4" />
            <AlertTitle>{t("encrypt.overLimit.title")}</AlertTitle>
            <AlertDescription>
              {t("encrypt.overLimit.body", {
                max: plaintextLimitBytes,
              })}
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
        {t(busy ? "encrypt.encryptButton.busy" : "encrypt.encryptButton.idle")}
      </Button>

      {(keysError || pqError || preferencesError || error) && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>{t("common.operationFailed")}</AlertTitle>
          <AlertDescription>{localizedError}</AlertDescription>
        </Alert>
      )}
      <p aria-live="polite" className="sr-only">
        {clearStatus === null ? "" : t(clearStatus)}
      </p>

      <Dialog
        open={result !== null}
        onOpenChange={(open) => {
          if (open) return
          resultAbortRef.current?.abort()
          resultAbortRef.current = null
          resetCompatibilityMode()
          setResultExporting(false)
          setResult(null)
          setOutputName("")
          setResultError(null)
        }}
      >
        <NoAutofocusDialogContent className="grid max-h-[95dvh] max-w-lg grid-rows-[minmax(0,1fr)] overflow-hidden">
          <div className="grid min-h-0 gap-5 overflow-y-auto pb-14">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                {t("encrypt.result.modalTitle")}
              </DialogTitle>
            </DialogHeader>
            {resultError && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{t("common.operationFailed")}</AlertTitle>
                <AlertDescription>{localizedResultError}</AlertDescription>
              </Alert>
            )}
            {result !== null && (
              <>
                <div data-testid="encrypt-result-qr">
                  {compatibilityError && (
                    <Alert variant="destructive" role="alert">
                      <AlertTitle>{t("common.operationFailed")}</AlertTitle>
                      <AlertDescription>{localizedCompatibilityError}</AlertDescription>
                    </Alert>
                  )}
                  {frameError && (
                    <Alert variant="destructive" role="alert">
                      <AlertTitle>{t("qrDisplay.error.title")}</AlertTitle>
                      <AlertDescription>{localizedFrameError}</AlertDescription>
                    </Alert>
                  )}
                  {frameSplit.frames.length === 0 && frameSplit.splitting && (
                    <p aria-live="polite" className="text-sm text-muted-foreground">
                      {t("qrDisplay.generating")}
                    </p>
                  )}
                  {result.kind === "sym" && frames[0] !== undefined && (
                    <QrDisplay
                      key={result.generation}
                      payload={frames[0].payload}
                      ecLevel="Q"
                      size={env.qrRenderSize}
                      title={t("encrypt.result.qrTitle")}
                    />
                  )}
                  {result.kind === "pq" &&
                    (frames.length > 0 || frameSplit.splitting) && (
                      <AnimatedQrFrames
                        key={result.generation}
                        frames={frameSplit.frames}
                        frameIntervalMs={frameProfile.frameIntervalMs}
                        densityRaised={frameProfile.densityRaised}
                        compatibilityControl={{
                          enabled: frameProfile.compatibilityEnabled,
                          disabled:
                            preferencesLoading ||
                            preferencesError !== null ||
                            compatibilityUpdating,
                          onEnabledChange: changeCompatibilityMode,
                        }}
                        outputName={outputName || result.artifactType}
                        title={t("encrypt.result.pqTitle")}
                        exportsEnabled={false}
                        splitting={frameSplit.splitting}
                      />
                    )}
                </div>

                <div data-testid="encrypt-result-payload" className="space-y-3">
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
                    {t("encrypt.result.copyPayload")}
                  </Button>
                </div>

                <div data-testid="encrypt-result-output" className="space-y-2">
                  <Label htmlFor="output-name">
                    {t("encrypt.result.outputNameLabel")}
                  </Label>
                  <Input
                    id="output-name"
                    value={outputName}
                    onChange={(event) => setOutputName(event.target.value)}
                    maxLength={80}
                    className="h-11"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full cursor-pointer"
                    disabled={resultExporting || !canExportResult}
                    onClick={() => void exportFrames()}
                  >
                    <Download aria-hidden="true" />
                    {t("common.download")}
                  </Button>
                </div>

                <Card
                  data-testid="encrypt-result-detail"
                  aria-label={t("encrypt.result.detailAria")}
                >
                  <CardHeader className="p-4 pb-3">
                    <CardTitle className="text-base">
                      {t("encrypt.result.detailTitle")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 p-4 pt-0 text-sm">
                    <DetailRow
                      label={t("encrypt.detail.suite")}
                      value={resultSuite ?? t("common.na")}
                    />
                    <DetailRow
                      label={t("encrypt.detail.recipientKeyId")}
                      value={
                        result.kind === "sym"
                          ? result.envelope.keyId
                          : result.envelope.recipientKemKeyId
                      }
                      mono
                    />
                    <DetailRow
                      label={t("encrypt.detail.senderSigningKeyId")}
                      value={
                        result.kind === "pq"
                          ? result.sender.signing.keyId
                          : t("common.na")
                      }
                      mono
                    />
                    <DetailRow
                      label={t("encrypt.detail.totalBytes")}
                      value={`${result.totalBytes} bytes`}
                      mono
                    />
                    <DetailRow
                      label={t("encrypt.detail.frameCount")}
                      value={t("encrypt.detail.frameCountValue", {
                        count: frames.length,
                      })}
                      mono
                    />
                    <DetailRow
                      label={t("encrypt.detail.encryptedAt")}
                      value={formatDateTime(result.createdAt, language)}
                    />
                    <DetailRow
                      label={t("encrypt.detail.signature")}
                      value={
                        result.kind === "pq" ? t("common.yes") : t("common.na")
                      }
                    />
                    <DetailRow
                      label={t("encrypt.detail.pqProfile")}
                      value={
                        result.kind === "pq"
                          ? ACTIVE_PROFILE
                          : t("encrypt.detail.notApplicable")
                      }
                    />
                    <DetailRow
                      label={t("encrypt.detail.wholeSha256")}
                      value={result.sha256}
                      mono
                    />
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </NoAutofocusDialogContent>
      </Dialog>
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
  const { t } = useI18n()
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {items.length > 0 ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="h-11 text-base">
            <SelectValue
              placeholder={t(
                loading
                  ? "encrypt.recordSelect.loading"
                  : "encrypt.recordSelect.placeholder",
              )}
            />
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
          {t("encrypt.recordSelect.noKeys")}{" "}
          <Link to="/keys" className="font-medium text-primary underline">
            {t("common.openKeysPage")}
          </Link>
        </div>
      )}
    </div>
  )
}
