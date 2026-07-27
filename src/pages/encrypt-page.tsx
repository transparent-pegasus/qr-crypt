import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Link } from "react-router"
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  Eraser,
  LoaderCircle,
  Lock,
  LockOpen,
} from "lucide-react"
import { toast } from "sonner"
import { decryptWithAesKey, encryptWithAesKey } from "@/crypto/aes-gcm"
import { AppError, toAppError } from "@/crypto/errors"
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
import { QrScannerModal } from "@/components/qr-scanner-panel"
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
import { bytesToUtf8, sha256Hex, utf8ToBytes } from "@/lib/bytes"
import {
  FRAME_BYTES_MAX,
  maximumSymmetricPlaintextBytesForPayloadCapacity,
  minimumFrameBytesForArtifact,
} from "@/lib/limits"
import { ecLevelFor, payloadFits, qrByteCapacity } from "@/qr/encode"
import {
  buildExportFileName,
  copyTextToClipboard,
  qrPngBlob,
  triggerDownload,
} from "@/qr/export-image"
import { buildV2Payload } from "@/qr/payload-v2"
import { decodePayload, encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"
import {
  COMPATIBLE_GENERATED_DISPLAY_PAIR,
  DEFAULT_GENERATED_DISPLAY_PAIR,
  type GeneratedDisplayPair,
  type MlKemMessageEnvelopeV2,
  type PostQuantumIdentity,
  type PqPublicBundleRecord,
  type Preferences,
  type StoredKeyRecord,
  type UiAlgorithm,
  type WireSuite,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { qrNameSchema } from "@/schemas/key-schema"
import { markKeyUsed } from "@/storage/key-repository"
import { markBundleUsed } from "@/storage/pq-bundle-repository"
import {
  findIdentityByKemKeyId,
  markIdentityUsed,
} from "@/storage/pq-identity-repository"

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
      artifactType: "pq-message"
      artifactBytes: Uint8Array
      generation: number
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

const EMPTY_ARTIFACT_BYTES = new Uint8Array()

function selectedGeneratedDisplayPair(
  preferences: Pick<Preferences, "frameBytes" | "frameIntervalMs">,
): GeneratedDisplayPair {
  return preferences.frameBytes === COMPATIBLE_GENERATED_DISPLAY_PAIR.frameBytes &&
    preferences.frameIntervalMs ===
      COMPATIBLE_GENERATED_DISPLAY_PAIR.frameIntervalMs
    ? COMPATIBLE_GENERATED_DISPLAY_PAIR
    : DEFAULT_GENERATED_DISPLAY_PAIR
}

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
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [compatibilityUpdating, setCompatibilityUpdating] = useState(false)
  const [compatibilityError, setCompatibilityError] =
    useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(
    error ?? compatibilityError ?? keysError ?? pqError ?? preferencesError,
  )
  const [result, setResult] = useState<EncryptionResult | null>(null)
  const [outputName, setOutputName] = useState("")
  const [decryptInput, setDecryptInput] = useState("")
  const [decrypted, setDecrypted] = useState<DecryptionResult | null>(null)
  const [clearStatus, setClearStatus] = useState<"encrypt.toast.autoCleared" | null>(null)
  const resultGenerationRef = useRef(0)
  const pqResult = result?.kind === "pq" ? result : null
  const selectedFramePair = selectedGeneratedDisplayPair(preferences)
  const compatibilityEnabled =
    selectedFramePair === COMPATIBLE_GENERATED_DISPLAY_PAIR
  const effectiveFrameBytes =
    pqResult === null
      ? selectedFramePair.frameBytes
      : Math.max(
          selectedFramePair.frameBytes,
          minimumFrameBytesForArtifact(pqResult.artifactBytes.byteLength),
        )
  const frameProfile = {
    frameBytes: effectiveFrameBytes,
    frameIntervalMs: selectedFramePair.frameIntervalMs,
    densityRaised:
      compatibilityEnabled &&
      effectiveFrameBytes > COMPATIBLE_GENERATED_DISPLAY_PAIR.frameBytes,
  }
  const frameSplit = useFrameSplit({
    bytes: pqResult?.artifactBytes ?? EMPTY_ARTIFACT_BYTES,
    artifactType: pqResult?.artifactType ?? "pq-message",
    frameBytes: frameProfile.frameBytes,
    enabled: pqResult !== null,
    generation: `${pqResult?.generation ?? 0}:${frameProfile.frameBytes}`,
  })
  const localizedFrameError = useLocalizedMessage(frameSplit.error)
  const changeCompatibilityMode = useCallback(
    async (enabled: boolean) => {
      setCompatibilityUpdating(true)
      setCompatibilityError(null)
      const pair = enabled
        ? COMPATIBLE_GENERATED_DISPLAY_PAIR
        : DEFAULT_GENERATED_DISPLAY_PAIR
      try {
        await updatePreferences({
          frameBytes: pair.frameBytes,
          frameIntervalMs: pair.frameIntervalMs,
        })
      } catch (caught) {
        setCompatibilityError(toAppError(caught, "STORAGE_FAILED").code)
      } finally {
        setCompatibilityUpdating(false)
      }
    },
    [updatePreferences],
  )

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
        (record) =>
          record.revokedAt === undefined &&
          isActiveBundle(record) &&
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
  // The ceilings are algorithm-specific: the PQ path is multipart and uses the
  // environment limit, while A256GCM still renders one v1 QR, so its plaintext is
  // bounded by the encoded-payload and error-correction capacity instead.
  const plaintextLimitBytes = useMemo(
    () =>
      algorithm === "A256GCM"
        ? maximumSymmetricPlaintextBytesForPayloadCapacity(
            qrByteCapacity(ecLevelFor("message", preferences)),
          )
        : env.maxPlaintextBytes,
    [algorithm, preferences],
  )
  const overPlaintextLimit = plaintextBytes.byteLength > plaintextLimitBytes
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
    setClearStatus("encrypt.toast.autoCleared")
    toast.info(t("encrypt.toast.autoCleared"))
  }, [multipartSession, t])

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
        const minimumFrameBytes = minimumFrameBytesForArtifact(artifactBytes.byteLength)
        if (minimumFrameBytes > FRAME_BYTES_MAX) {
          throw new AppError("QR_TOO_LARGE")
        }
        resultGenerationRef.current += 1
        setResult({
          kind: "pq",
          payload: buildV2Payload("pq-message", artifactBytes),
          envelope,
          artifactType: "pq-message",
          artifactBytes,
          generation: resultGenerationRef.current,
          recipient: selectedRecipient,
          ...(sender === undefined ? {} : { sender }),
          createdAt: now,
          totalBytes: artifactBytes.byteLength,
          sha256: await sha256Hex(artifactBytes),
        })
        await markBundleUsed(selectedRecipient.recordId, now).catch(() => undefined)
        if (sender) await markIdentityUsed(sender.id, now).catch(() => undefined)
      }
      setOutputName(
        t("encrypt.output.suggestedName", {
          date: formatSuggestedDate(now),
        }),
      )
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
        // The cached list only gates the button. Re-resolve from storage at action
        // time so a generation discarded elsewhere cannot be decrypted from a stale
        // in-memory object. A delete landing between this lookup and the worker call
        // is a residual race, recorded in docs/security/threat-model.md T14.
        const recipient = await findIdentityByKemKeyId(
          parsedDecrypt.envelope.recipientKemKeyId,
        )
        if (recipient === undefined || !isActiveIdentity(recipient)) {
          throw new AppError("KEY_NOT_FOUND")
        }
        const pqResult = await decryptPqMessage({
          client: getPqClient(),
          envelope: parsedDecrypt.envelope,
          recipient,
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
        await markIdentityUsed(recipient.id, Date.now()).catch(() => undefined)
      }
    } catch (caught) {
      setDecrypted(null)
      setError(toAppError(caught, "DECRYPTION_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const copyPayload = async () => {
    if (!result) return
    try {
      await copyTextToClipboard(result.payload)
      toast.success(t("encrypt.toast.payloadCopied"))
    } catch {
      setError("common.copyFailed")
    }
  }

  const exportSingle = async () => {
    if (result?.kind !== "aes") return
    const parsedName = qrNameSchema.safeParse(outputName)
    if (!parsedName.success) {
      setError(
        messageKeyOrFallback(
          parsedName.error.issues[0]?.message,
          "encrypt.validation.outputNameFallback",
        ),
      )
      return
    }
    try {
      const id = generateArtifactId()
      const ecLevel = ecLevelFor("message", preferences)
      const blob = await qrPngBlob(result.payload, {
        ecLevel,
        size: env.qrRenderSize,
      })
      triggerDownload(blob, buildExportFileName(parsedName.data, id, "png"))
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").code)
    }
  }

  const resultSuite: WireSuite | "A256GCM" | null =
    result?.kind === "aes" ? "A256GCM" : (result?.envelope.suite ?? null)

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6" aria-busy={busy}>
      <h2 className="sr-only">{t("encrypt.srHeading")}</h2>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value === "decrypt" ? "decrypt" : "encrypt")
          setError(null)
        }}
      >
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="encrypt" className="h-9 cursor-pointer">
            {t("encrypt.tab.encrypt")}
          </TabsTrigger>
          <TabsTrigger value="decrypt" className="h-9 cursor-pointer">
            {t("encrypt.tab.decrypt")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "encrypt" ? (
        <>
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
                  label: `${t(
                    record.trust === "fingerprint-confirmed"
                      ? "encrypt.recipient.confirmed"
                      : "encrypt.recipient.unverified",
                  )}: ${
                    record.trust === "fingerprint-confirmed"
                      ? (record.name ?? record.kem.keyId)
                      : record.kem.keyId
                  }`,
                }))}
              />
              {!pqLoading && recipients.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("encrypt.recipient.needsConfirmation")}
                </p>
              )}
              {signed && (
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
              )}
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
        </>
      ) : (
        <>
          <Card aria-labelledby="decrypt-camera-title">
            <CardHeader className="p-4 pb-3">
              <h3
                id="decrypt-camera-title"
                className="font-semibold leading-none tracking-tight"
              >
                {t("encrypt.decrypt.cameraTitle")}
              </h3>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              <QrScannerModal
                triggerLabel={t("encrypt.decrypt.scanTrigger")}
                className="space-y-6"
                singleTargets={["message"]}
                cameraAvailable={camera}
                title={t("encrypt.decrypt.scanTrigger")}
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
            </CardContent>
          </Card>

          <Card aria-labelledby="decrypt-paste-title">
            <CardHeader className="p-4 pb-3">
              <h3
                id="decrypt-paste-title"
                className="font-semibold leading-none tracking-tight"
              >
                {t("common.pastePayload")}
              </h3>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-0">
              <div className="space-y-2">
                <Label htmlFor="decrypt-payload">
                  {t("encrypt.decrypt.payloadLabel")}
                </Label>
                <Textarea
                  id="decrypt-payload"
                  value={decryptInput}
                  onChange={(event) => {
                    setDecryptInput(event.target.value)
                    setDecrypted(null)
                    setError(null)
                  }}
                  className="min-h-28 break-all font-mono text-base focus-visible:ring-2"
                  placeholder={t("encrypt.decrypt.payloadPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
              </div>
              {decryptInputInvalid && (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>{t("encrypt.decrypt.invalidTitle")}</AlertTitle>
                  <AlertDescription>{t("encrypt.decrypt.invalidBody")}</AlertDescription>
                </Alert>
              )}
              {parsedDecrypt && (
                <div className="space-y-2 text-sm">
                  <DetailRow
                    label={t("encrypt.detail.method")}
                    value={
                      parsedDecrypt.kind === "message"
                        ? "A256GCM"
                        : parsedDecrypt.envelope.suite
                    }
                  />
                  <DetailRow
                    label={t("encrypt.detail.recipientKeyId")}
                    value={
                      parsedDecrypt.kind === "message"
                        ? parsedDecrypt.envelope.keyId
                        : parsedDecrypt.envelope.recipientKemKeyId
                    }
                    mono
                  />
                </div>
              )}
              {parsedPqUnsupported && (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>{t("keyDetail.badge.legacyProfile")}</AlertTitle>
                  <AlertDescription>{t("encrypt.pqUnsupported.body")}</AlertDescription>
                </Alert>
              )}
              {parsedDecrypt && !parsedPqUnsupported && !canDecrypt && (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>KEY_NOT_FOUND</AlertTitle>
                  <AlertDescription>{t("errors.KEY_NOT_FOUND")}</AlertDescription>
                </Alert>
              )}
              <Button
                type="button"
                className="h-11 w-full cursor-pointer focus-visible:ring-2"
                disabled={!canDecrypt}
                onClick={() => void handleDecrypt()}
              >
                {busy ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <LockOpen aria-hidden="true" />
                )}
                {t(busy ? "encrypt.decryptButton.busy" : "encrypt.decryptButton.idle")}
              </Button>
            </CardContent>
          </Card>

          {decrypted?.kind === "signed-key-unknown" && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>SIGNING_KEY_NOT_FOUND</AlertTitle>
              <AlertDescription>
                {t("errors.SIGNING_KEY_NOT_FOUND")}
                {t("encrypt.signingKeyId", {
                  id: decrypted.senderSigningKeyId,
                })}
                <br />
                <Link to="/keys" className="font-medium underline">
                  {t("encrypt.importSigningKey")}
                </Link>
              </AlertDescription>
            </Alert>
          )}
          {decrypted && decrypted.kind !== "signed-key-unknown" && (
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                  {t("encrypt.result.decryptedTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-0">
                {decrypted.kind === "unsigned" && (
                  <p className="text-sm font-medium">{t("encrypt.result.unsigned")}</p>
                )}
                {decrypted.kind === "aes" && (
                  <p className="text-sm font-medium">{t("encrypt.result.aesUnsigned")}</p>
                )}
                {decrypted.kind === "signed-valid" && (
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-success">
                      {t("encrypt.result.signatureValid")}
                    </p>
                    <p className="font-mono text-xs break-all">
                      {t("encrypt.result.senderSigningKeyId", {
                        id: decrypted.senderSigningKeyId,
                      })}
                    </p>
                    <p>
                      {t("encrypt.result.identityCheck.label")}{" "}
                      {decrypted.sender?.trust === "fingerprint-confirmed"
                        ? t("encrypt.result.identityCheck.confirmed")
                        : t("encrypt.result.identityCheck.unverified")}
                    </p>
                  </div>
                )}
                <p className="select-text whitespace-pre-wrap break-words rounded-md border p-3 text-sm">
                  {decrypted.text}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("encrypt.result.memoryOnly")}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 w-full cursor-pointer"
                  onClick={() => setDecrypted(null)}
                >
                  <Eraser aria-hidden="true" />
                  {t("encrypt.clearPlaintext")}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {(keysError || pqError || preferencesError || error || compatibilityError) && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>{t("common.operationFailed")}</AlertTitle>
          <AlertDescription>{localizedError}</AlertDescription>
        </Alert>
      )}
      <p aria-live="polite" className="sr-only">
        {clearStatus === null ? "" : t(clearStatus)}
      </p>

      {result && mode === "encrypt" && (
        <section aria-label={t("encrypt.result.sectionAria")} className="space-y-5">
          <Card>
            <CardHeader className="p-4 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                {t("encrypt.result.encryptDone")}
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
                {t("encrypt.result.copyPayload")}
              </Button>
            </CardContent>
          </Card>

          {result.kind === "aes" ? (
            <QrDisplay
              payload={result.payload}
              ecLevel={ecLevelFor("message", preferences)}
              size={env.qrRenderSize}
              title={t("encrypt.result.qrTitle")}
            />
          ) : (
            <>
              {frameSplit.error && (
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
              {(frameSplit.frames.length > 0 || frameSplit.splitting) && (
                <AnimatedQrFrames
                  key={result.generation}
                  frames={frameSplit.frames}
                  frameIntervalMs={frameProfile.frameIntervalMs}
                  densityRaised={frameProfile.densityRaised}
                  compatibilityControl={{
                    enabled: compatibilityEnabled,
                    disabled:
                      preferencesLoading ||
                      preferencesError !== null ||
                      compatibilityUpdating,
                    onEnabledChange: changeCompatibilityMode,
                  }}
                  outputName={outputName || "pq-message"}
                  title={t("encrypt.result.pqTitle")}
                  splitting={frameSplit.splitting}
                />
              )}
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="output-name">{t("encrypt.result.outputNameLabel")}</Label>
            <Input
              id="output-name"
              value={outputName}
              onChange={(event) => setOutputName(event.target.value)}
              maxLength={80}
              className="h-11"
            />
          </div>

          {result.kind === "aes" && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full cursor-pointer"
              onClick={() => void exportSingle()}
            >
              <Download aria-hidden="true" />
              {t("common.download")}
            </Button>
          )}

          <Card aria-label={t("encrypt.result.detailAria")}>
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
                  result.kind === "aes"
                    ? result.envelope.keyId
                    : result.envelope.recipientKemKeyId
                }
                mono
              />
              <DetailRow
                label={t("encrypt.detail.senderSigningKeyId")}
                value={
                  result.kind === "pq"
                    ? (result.sender?.signing.keyId ?? t("common.na"))
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
                  count: result.kind === "pq" ? frameSplit.frames.length : 1,
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
                  result.kind === "pq" && result.sender ? t("common.yes") : t("common.na")
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
