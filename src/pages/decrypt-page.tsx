import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { AlertCircle, CheckCircle2, LoaderCircle, LockOpen } from "lucide-react"
import { toast } from "sonner"
import { openSymMessage } from "@/crypto/aes-gcm"
import { AppError, toAppError } from "@/crypto/errors"
import {
  decodeMlKemEnvelopeV2,
  decodeSymMessageEnvelopeV2,
  encodeMlKemEnvelopeV2,
  encodeSymMessageEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import { zeroize } from "@/crypto/pq/zeroize"
import { assertActiveSuite } from "@/crypto/pq/suites"
import { validateSymMessageEnvelopeV2 } from "@/crypto/pq/validation"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import {
  useFeatureSupport,
  useSensitiveSession,
  useTransientClear,
} from "@/app/providers"
import { DetailRow } from "@/components/detail-row"
import {
  isUsableBundle,
  isUsableIdentity,
} from "@/components/key-detail/identity-policy"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { QrScannerModal } from "@/components/qr-scanner-modal"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import { formatDateTime } from "@/features/presentation"
import { recordReceipt, type ReceiptVerdict } from "@/features/receipt-cache"
import { useAutoClear } from "@/hooks/use-auto-clear"
import { useKeys } from "@/hooks/use-keys"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePqRecords } from "@/hooks/use-pq-records"
import { usePreferences } from "@/hooks/use-preferences"
import { useI18n, useLocalizedMessage, type LocalizedMessage } from "@/i18n"
import {
  bytesToHex,
  bytesToUtf8,
  countUnicodeFormatCharacters,
} from "@/lib/bytes"
import { buildV2Payload } from "@/qr/payload-v2"
import {
  decodePayload,
  payloadSha256Hex,
} from "@/qr/payload"
import type {
  PqPublicBundleRecord,
  WireSuite,
} from "@/schemas/domain"
import { markKeyUsed } from "@/storage/key-repository"
import { findBundleBySigningKeyId } from "@/storage/pq-bundle-repository"
import {
  findIdentityByKemKeyId,
  markIdentityUsed,
} from "@/storage/pq-identity-repository"

type DecryptionResult =
  | {
      kind: "signed-valid"
      text: string
      replay: ReceiptVerdict
      senderCreatedAt: number
      senderSigningKeyId: string
      sender: PqPublicBundleRecord
    }
  | { kind: "signed-key-unknown"; senderSigningKeyId: string }
  | { kind: "aes"; text: string; replay: ReceiptVerdict }

function isActiveWireSuite(suite: WireSuite): boolean {
  try {
    assertActiveSuite(suite)
    return true
  } catch {
    return false
  }
}

export function DecryptPage() {
  const { language, t } = useI18n()
  const { keys, error: keysError } = useKeys()
  const { identities, error: pqError } = usePqRecords()
  const { preferences, error: preferencesError } = usePreferences()
  const getPqClient = usePqCryptoClient()
  const { camera } = useFeatureSupport()
  const { nonce } = useTransientClear()
  const { setSensitiveSession, resetSensitiveSession } = useSensitiveSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(
    error ?? keysError ?? pqError ?? preferencesError,
  )
  const [decryptInput, setDecryptInput] = useState("")
  const [decrypted, setDecrypted] = useState<DecryptionResult | null>(null)
  const [replayAcknowledged, setReplayAcknowledged] = useState(false)
  const [clearStatus, setClearStatus] = useState<"encrypt.toast.autoCleared" | null>(null)
  const pendingDecryptRef = useRef<string | null>(null)

  const clearDecrypted = useCallback(() => {
    setDecrypted(null)
    setReplayAcknowledged(false)
  }, [])

  const symmetricKeys = keys

  const multipartSession = useMemo(
    () => new MultipartScanSession(preferences.transferTimeoutMinutes),
    [preferences.transferTimeoutMinutes],
  )

  const parsedDecrypt = useMemo(() => {
    const input = decryptInput.trim()
    if (!input) return null
    try {
      const decoded = decodePayload(input)
      return decoded.kind === "sym-message" ||
        decoded.kind === "pq-message"
        ? decoded
        : null
    } catch {
      return null
    }
  }, [decryptInput])
  const decryptInputInvalid = decryptInput.trim().length > 0 && parsedDecrypt === null
  const parsedPqUnsupported =
    parsedDecrypt?.kind === "pq-message" &&
    !isActiveWireSuite(parsedDecrypt.envelope.suite)
  const decryptSymmetricKey =
    parsedDecrypt?.kind === "sym-message"
      ? symmetricKeys.find((key) => key.id === parsedDecrypt.envelope.keyId)
      : undefined
  const decryptIdentity =
    parsedDecrypt?.kind === "pq-message"
      ? identities.find(
          (identity) =>
            identity.kem.keyId === parsedDecrypt.envelope.recipientKemKeyId &&
            isUsableIdentity(identity),
        )
      : undefined
  const decryptKeyMissing =
    parsedDecrypt !== null &&
    !parsedPqUnsupported &&
    (parsedDecrypt.kind === "pq-message"
      ? decryptIdentity === undefined
      : decryptSymmetricKey === undefined)
  const canDecrypt =
    !busy &&
    parsedDecrypt !== null &&
    !parsedPqUnsupported &&
    (parsedDecrypt.kind === "pq-message"
      ? decryptIdentity !== undefined
      : decryptSymmetricKey !== undefined)
  const formatCharacterCount =
    decrypted !== null && decrypted.kind !== "signed-key-unknown"
      ? countUnicodeFormatCharacters(decrypted.text)
      : 0

  useEffect(() => {
    setSensitiveSession({
      hasDecrypted: decrypted !== null && decrypted.kind !== "signed-key-unknown",
      cryptoBusy: busy,
      secretVisible: false,
    })
  }, [busy, decrypted, setSensitiveSession])
  useEffect(
    () => () => {
      resetSensitiveSession()
    },
    [resetSensitiveSession],
  )
  // Navigating away unmounts this page, so drop any half-assembled transfer with it
  // rather than leaving decoded frames reachable from the session object.
  useEffect(() => () => multipartSession.discard(), [multipartSession])

  const clearTransient = useCallback(() => {
    pendingDecryptRef.current = null
    setDecryptInput("")
    clearDecrypted()
    setError(null)
    multipartSession.discard()
    setClearStatus("encrypt.toast.autoCleared")
    toast.info(t("encrypt.toast.autoCleared"))
  }, [clearDecrypted, multipartSession, t])

  useAutoClear({
    enabled: preferences.backgroundClearEnabled,
    onClear: clearTransient,
    clearNonce: nonce,
  })

  const runDecrypt = async (payload: string) => {
    let parsed: ReturnType<typeof decodePayload> | null = null
    try {
      const decoded = decodePayload(payload.trim())
      parsed =
        decoded.kind === "sym-message" ||
        decoded.kind === "pq-message"
          ? decoded
          : null
    } catch {
      parsed = null
    }
    if (parsed === null) return
    if (parsed.kind === "pq-message" && !isActiveWireSuite(parsed.envelope.suite)) return

    const symmetricKey =
      parsed.kind === "sym-message"
        ? symmetricKeys.find((key) => key.id === parsed.envelope.keyId)
        : undefined
    const identity =
      parsed.kind === "pq-message"
        ? identities.find(
            (candidate) =>
              candidate.kem.keyId === parsed.envelope.recipientKemKeyId &&
              isUsableIdentity(candidate),
          )
        : undefined
    if (
      parsed.kind === "pq-message"
        ? identity === undefined
        : symmetricKey === undefined
    ) {
      return
    }

    setBusy(true)
    setError(null)
    clearDecrypted()
    try {
      if (parsed.kind === "sym-message" && symmetricKey) {
        const decryptedBytes = await openSymMessage({
          record: symmetricKey,
          envelope: parsed.envelope,
        })
        try {
          const envelopeHash = await payloadSha256Hex(
            buildV2Payload(
              "sym-message",
              encodeSymMessageEnvelopeV2(parsed.envelope),
            ),
          )
          const verdict = recordReceipt(
            {
              kind: "sym",
              recipientKeyId: symmetricKey.id,
              envelopeHash,
            },
            Date.now(),
          )
          // Unreachable for symmetric messages — their receipt identity includes the
          // ciphertext hash — but the refusal is shared with the PQ path.
          if (verdict.kind === "message-id-reused") {
            throw new AppError("MESSAGE_ID_REUSED")
          }
          const outcome: DecryptionResult = {
            kind: "aes",
            text: bytesToUtf8(decryptedBytes),
            replay: verdict,
          }
          await markKeyUsed(symmetricKey.id, Date.now()).catch(() => undefined)
          setDecrypted(outcome)
        } finally {
          zeroize(decryptedBytes)
        }
      } else if (parsed.kind === "pq-message" && identity) {
        // The cached list only gates the button. Re-resolve from storage at action
        // time so a generation discarded elsewhere cannot be decrypted from a stale
        // in-memory object. A delete landing between this lookup and the worker call
        // is a residual race, recorded in docs/security/threat-model.md T14.
        const recipient = await findIdentityByKemKeyId(
          parsed.envelope.recipientKemKeyId,
        )
        if (recipient === undefined || !isUsableIdentity(recipient)) {
          throw new AppError("KEY_NOT_FOUND")
        }
        // Key ids are attacker-assertable, so the record that verifies the signature is
        // also the record shown as the sender: one exact lookup, no list ordering.
        let resolvedSender: PqPublicBundleRecord | undefined
        const pqResult = await decryptPqMessage({
          client: getPqClient(),
          envelope: parsed.envelope,
          recipient,
          vaultKey: await getOrCreateVaultKey(),
          resolveSigningKey: async (keyId) => {
            const record = await findBundleBySigningKeyId(keyId)
            if (record === undefined || !isUsableBundle(record)) return undefined
            resolvedSender = record
            return {
              algorithm: record.signing.algorithm,
              publicKey: record.signing.publicKey,
              revoked: record.revokedAt !== undefined,
            }
          },
        })
        if (pqResult.kind === "signed-key-unknown") {
          await markIdentityUsed(recipient.id, Date.now()).catch(() => undefined)
          setDecrypted(pqResult)
        } else {
          const decryptedBytes = pqResult.plaintext
          try {
            // The inner message must be decrypted, and for signed suites verified,
            // before its message id is known. The guarantee is that refused plaintext
            // is never displayed or persisted, not that it is never constructed.
            const envelopeHash = await payloadSha256Hex(
              buildV2Payload(
                "pq-message",
                encodeMlKemEnvelopeV2(parsed.envelope),
              ),
            )
            const messageIdHex = bytesToHex(pqResult.messageId)
            if (resolvedSender === undefined) {
              throw new AppError("DECRYPTION_FAILED")
            }
            const verdict = recordReceipt(
              {
                kind: "pq-signed",
                senderFingerprint: resolvedSender.signing.fingerprint,
                recipientKemKeyId: parsed.envelope.recipientKemKeyId,
                messageIdHex,
                envelopeHash,
              },
              Date.now(),
            )
            if (verdict.kind === "message-id-reused") {
              throw new AppError("MESSAGE_ID_REUSED")
            }
            const outcome: DecryptionResult = {
              kind: "signed-valid",
              text: bytesToUtf8(decryptedBytes),
              replay: verdict,
              senderCreatedAt: pqResult.createdAt,
              senderSigningKeyId: pqResult.senderSigningKeyId,
              sender: resolvedSender,
            }
            await markIdentityUsed(recipient.id, Date.now()).catch(() => undefined)
            setDecrypted(outcome)
          } finally {
            zeroize(decryptedBytes)
          }
        }
      }
    } catch (caught) {
      clearDecrypted()
      setError(toAppError(caught, "DECRYPTION_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6" aria-busy={busy}>
      <h2 className="sr-only">{t("decrypt.srHeading")}</h2>

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
            cameraAvailable={camera}
            triggerDisabled={busy}
            title={t("encrypt.decrypt.scanTrigger")}
            multipart={{
              session: multipartSession,
              onComplete: ({ artifactType, artifactBytes }) => {
                // The payload string below is the working copy from here on, so the
                // assembler's own copy of the ciphertext is released immediately.
                try {
                  let payload: string
                  if (artifactType === "pq-message") {
                    const envelope = decodeMlKemEnvelopeV2(artifactBytes)
                    payload = buildV2Payload(
                      "pq-message",
                      encodeMlKemEnvelopeV2(envelope),
                    )
                  } else if (artifactType === "sym-message") {
                    const envelope = validateSymMessageEnvelopeV2(
                      decodeSymMessageEnvelopeV2(artifactBytes),
                    )
                    payload = buildV2Payload(
                      "sym-message",
                      encodeSymMessageEnvelopeV2(envelope),
                    )
                  } else {
                    throw new AppError("INVALID_QR_PAYLOAD")
                  }
                  setDecryptInput(payload)
                  clearDecrypted()
                  setError(null)
                  pendingDecryptRef.current = payload
                } finally {
                  multipartSession.discard()
                }
              },
            }}
            onClosed={() => {
              const payload = pendingDecryptRef.current
              pendingDecryptRef.current = null
              if (payload !== null) void runDecrypt(payload)
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
                clearDecrypted()
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
            <Alert
              variant="destructive"
              role="alert"
              aria-labelledby="decrypt-invalid-title"
            >
              <AlertTitle id="decrypt-invalid-title">
                {t("encrypt.decrypt.invalidTitle")}
              </AlertTitle>
              <AlertDescription>{t("encrypt.decrypt.invalidBody")}</AlertDescription>
            </Alert>
          )}
          {parsedDecrypt && (
            <div className="space-y-2 text-sm">
              <DetailRow
                label={t("encrypt.detail.method")}
                value={parsedDecrypt.envelope.suite}
              />
              <DetailRow
                label={t("encrypt.detail.recipientKeyId")}
                value={
                  parsedDecrypt.kind === "pq-message"
                    ? parsedDecrypt.envelope.recipientKemKeyId
                    : parsedDecrypt.envelope.keyId
                }
                mono
              />
            </div>
          )}
          {parsedPqUnsupported && (
            <Alert
              variant="destructive"
              role="alert"
              aria-labelledby="decrypt-pq-unsupported-title"
            >
              <AlertTitle id="decrypt-pq-unsupported-title">
                {t("keyDetail.badge.legacyProfile")}
              </AlertTitle>
              <AlertDescription>{t("encrypt.pqUnsupported.body")}</AlertDescription>
            </Alert>
          )}
          {decryptKeyMissing && (
            <Alert
              variant="destructive"
              role="alert"
              aria-labelledby="decrypt-key-missing-title"
            >
              <AlertTitle id="decrypt-key-missing-title">KEY_NOT_FOUND</AlertTitle>
              <AlertDescription>{t("errors.KEY_NOT_FOUND")}</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            className="h-11 w-full cursor-pointer focus-visible:ring-2"
            disabled={!canDecrypt}
            onClick={() => void runDecrypt(decryptInput)}
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
        <Alert
          variant="destructive"
          role="alert"
          aria-labelledby="decrypt-signing-key-missing-title"
        >
          <AlertTitle id="decrypt-signing-key-missing-title">
            SIGNING_KEY_NOT_FOUND
          </AlertTitle>
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

      {(keysError || pqError || preferencesError || error) && (
        <Alert
          variant="destructive"
          role="alert"
          aria-labelledby="decrypt-operation-failed-title"
        >
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle id="decrypt-operation-failed-title">
            {t("common.operationFailed")}
          </AlertTitle>
          <AlertDescription>{localizedError}</AlertDescription>
        </Alert>
      )}
      <p aria-live="polite" className="sr-only">
        {clearStatus === null ? "" : t(clearStatus)}
      </p>

      <Dialog
        open={decrypted !== null && decrypted.kind !== "signed-key-unknown"}
        onOpenChange={(open) => {
          if (!open) clearDecrypted()
        }}
      >
        <NoAutofocusDialogContent className="grid max-h-[95dvh] max-w-lg grid-rows-[minmax(0,1fr)] overflow-hidden">
          <div className="grid min-h-0 gap-4 overflow-y-auto pb-14">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
                {t("encrypt.result.decryptedModalTitle")}
              </DialogTitle>
            </DialogHeader>
            {decrypted !== null && decrypted.kind !== "signed-key-unknown" && (
              <>
                {decrypted.kind === "aes" && (
                  <p className="text-sm font-medium">{t("encrypt.result.symmetric")}</p>
                )}
                {decrypted.kind === "signed-valid" && (
                  <>
                    <div className="space-y-1 text-sm">
                      <p
                        className={
                          decrypted.sender.trust === "fingerprint-confirmed"
                            ? "font-medium text-success"
                            : "font-medium"
                        }
                      >
                        {t("encrypt.result.signatureValid")}
                      </p>
                      <p className="font-mono text-xs break-all">
                        {t("encrypt.result.senderSigningKeyId", {
                          id: decrypted.senderSigningKeyId,
                        })}
                      </p>
                      {decrypted.sender.trust === "fingerprint-confirmed" && (
                        <p className="font-medium text-success">
                          {t("encrypt.result.identityCheck.label")}{" "}
                          {t("encrypt.result.identityCheck.confirmed")}
                        </p>
                      )}
                    </div>
                    {decrypted.sender.trust !== "fingerprint-confirmed" && (
                      <Alert
                        variant="destructive"
                        role="group"
                        aria-labelledby="decrypt-identity-unconfirmed-title"
                      >
                        <AlertTitle id="decrypt-identity-unconfirmed-title">
                          {t("encrypt.result.identityUnconfirmed.title")}
                        </AlertTitle>
                        <AlertDescription
                          role="alert"
                          aria-labelledby="decrypt-identity-unconfirmed-title"
                        >
                          <p>{t("encrypt.result.identityUnconfirmed.body")}</p>
                          <p className="mt-2">
                            {t("encrypt.result.identityCheck.label")}{" "}
                            {t("encrypt.result.identityCheck.unverified")}
                          </p>
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                )}
                {decrypted.kind === "signed-valid" && (
                  <p className="text-xs text-muted-foreground">
                    {t("encrypt.result.senderCreatedAt", {
                      time: formatDateTime(decrypted.senderCreatedAt, language),
                    })}
                  </p>
                )}
                {decrypted.replay.kind === "already-received" && (
                  <Alert
                    variant="destructive"
                    role="alert"
                    aria-labelledby="decrypt-replay-title"
                  >
                    <AlertTitle id="decrypt-replay-title">
                      {t("encrypt.result.replay.title")}
                    </AlertTitle>
                    <AlertDescription>
                      <p>
                        {t("encrypt.result.replay.body", {
                          time: formatDateTime(
                            decrypted.replay.firstSeenAt,
                            language,
                          ),
                        })}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3"
                        onClick={() => setReplayAcknowledged(true)}
                      >
                        {t("encrypt.result.replay.reveal")}
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {formatCharacterCount > 0 && (
                  <Alert
                    variant="destructive"
                    role="group"
                    aria-labelledby="decrypt-invisible-characters-title"
                  >
                    <AlertTitle id="decrypt-invisible-characters-title">
                      {t("encrypt.result.invisibleCharacters.title")}
                    </AlertTitle>
                    <AlertDescription
                      role="alert"
                      aria-labelledby="decrypt-invisible-characters-title"
                    >
                      {t("encrypt.result.invisibleCharacters.body", {
                        count: formatCharacterCount,
                      })}
                    </AlertDescription>
                  </Alert>
                )}
                {(decrypted.replay.kind !== "already-received" ||
                  replayAcknowledged) && (
                  <p className="select-text whitespace-pre-wrap break-words rounded-md border p-3 text-sm">
                    {decrypted.text}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("encrypt.result.memoryOnly")}
                </p>
              </>
            )}
          </div>
        </NoAutofocusDialogContent>
      </Dialog>
    </section>
  )
}
