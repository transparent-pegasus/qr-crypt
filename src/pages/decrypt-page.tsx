import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { AlertCircle, CheckCircle2, LoaderCircle, LockOpen } from "lucide-react"
import { toast } from "sonner"
import { decryptWithAesKey } from "@/crypto/aes-gcm"
import { AppError, toAppError } from "@/crypto/errors"
import { decodeMlKemEnvelopeV2, encodeMlKemEnvelopeV2 } from "@/crypto/pq/canonical-cbor"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import {
  assertActiveProfile,
  assertActiveSuite,
  resolveSuite,
} from "@/crypto/pq/suites"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import {
  useFeatureSupport,
  useSensitiveSession,
  useTransientClear,
} from "@/app/providers"
import { DetailRow } from "@/components/detail-row"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { QrScannerModal } from "@/components/qr-scanner-panel"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import { useAutoClear } from "@/hooks/use-auto-clear"
import { useKeys } from "@/hooks/use-keys"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePqRecords } from "@/hooks/use-pq-records"
import { usePreferences } from "@/hooks/use-preferences"
import { useI18n, useLocalizedMessage, type LocalizedMessage } from "@/i18n"
import { bytesToUtf8 } from "@/lib/bytes"
import { buildV2Payload } from "@/qr/payload-v2"
import { decodePayload } from "@/qr/payload"
import type {
  PostQuantumIdentity,
  PqPublicBundleRecord,
  WireSuite,
} from "@/schemas/domain"
import { markKeyUsed } from "@/storage/key-repository"
import {
  findIdentityByKemKeyId,
  markIdentityUsed,
} from "@/storage/pq-identity-repository"

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

export function DecryptPage() {
  const { t } = useI18n()
  const { keys, error: keysError } = useKeys()
  const { identities, bundles, error: pqError } = usePqRecords()
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
  const [clearStatus, setClearStatus] = useState<"encrypt.toast.autoCleared" | null>(null)
  const pendingDecryptRef = useRef<string | null>(null)

  const symmetricKeys = useMemo(
    () =>
      keys.filter((key) => key.kind === "symmetric" && key.symmetricKey !== undefined),
    [keys],
  )

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
  const decryptKeyMissing =
    parsedDecrypt !== null &&
    !parsedPqUnsupported &&
    (parsedDecrypt.kind === "message"
      ? decryptAesKey === undefined
      : decryptIdentity === undefined)
  const canDecrypt =
    !busy &&
    parsedDecrypt !== null &&
    !parsedPqUnsupported &&
    (parsedDecrypt.kind === "message"
      ? decryptAesKey !== undefined
      : decryptIdentity !== undefined)

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
    setDecrypted(null)
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

  const runDecrypt = async (payload: string) => {
    let parsed: ReturnType<typeof decodePayload> | null = null
    try {
      const decoded = decodePayload(payload.trim())
      parsed =
        decoded.kind === "message" || decoded.kind === "pq-message" ? decoded : null
    } catch {
      parsed = null
    }
    if (parsed === null) return
    if (parsed.kind === "pq-message" && !isActiveWireSuite(parsed.envelope.suite)) return

    const aesKey =
      parsed.kind === "message"
        ? symmetricKeys.find((key) => key.id === parsed.envelope.keyId)
        : undefined
    const identity =
      parsed.kind === "pq-message"
        ? identities.find(
            (candidate) =>
              candidate.kem.keyId === parsed.envelope.recipientKemKeyId &&
              isActiveIdentity(candidate),
          )
        : undefined
    if (parsed.kind === "message" ? aesKey === undefined : identity === undefined) return

    setBusy(true)
    setError(null)
    setDecrypted(null)
    try {
      if (parsed.kind === "message" && aesKey?.symmetricKey) {
        const plaintextResult = await decryptWithAesKey({
          key: aesKey.symmetricKey,
          envelope: parsed.envelope,
        })
        const outcome: DecryptionResult = {
          kind: "aes",
          text: bytesToUtf8(plaintextResult),
        }
        await markKeyUsed(aesKey.id, Date.now()).catch(() => undefined)
        setDecrypted(outcome)
      } else if (parsed.kind === "pq-message" && identity) {
        // The cached list only gates the button. Re-resolve from storage at action
        // time so a generation discarded elsewhere cannot be decrypted from a stale
        // in-memory object. A delete landing between this lookup and the worker call
        // is a residual race, recorded in docs/security/threat-model.md T14.
        const recipient = await findIdentityByKemKeyId(
          parsed.envelope.recipientKemKeyId,
        )
        if (recipient === undefined || !isActiveIdentity(recipient)) {
          throw new AppError("KEY_NOT_FOUND")
        }
        const pqResult = await decryptPqMessage({
          client: getPqClient(),
          envelope: parsed.envelope,
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
        let outcome: DecryptionResult
        if (pqResult.kind === "signed-key-unknown") {
          outcome = pqResult
        } else if (pqResult.kind === "unsigned") {
          outcome = { kind: "unsigned", text: bytesToUtf8(pqResult.plaintext) }
        } else {
          outcome = {
            kind: "signed-valid",
            text: bytesToUtf8(pqResult.plaintext),
            senderSigningKeyId: pqResult.senderSigningKeyId,
            sender: bundles.find(
              (bundle) =>
                bundle.signing.keyId === pqResult.senderSigningKeyId &&
                isActiveBundle(bundle),
            ),
          }
        }
        await markIdentityUsed(recipient.id, Date.now()).catch(() => undefined)
        setDecrypted(outcome)
      }
    } catch (caught) {
      setDecrypted(null)
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
            singleTargets={["message"]}
            cameraAvailable={camera}
            triggerDisabled={busy}
            title={t("encrypt.decrypt.scanTrigger")}
            onSingleScan={(_target, payload) => {
              setDecryptInput(payload)
              setDecrypted(null)
              setError(null)
              pendingDecryptRef.current = payload
            }}
            multipart={{
              session: multipartSession,
              onComplete: ({ artifactType, artifactBytes }) => {
                // The payload string below is the working copy from here on, so the
                // assembler's own copy of the ciphertext is released immediately.
                try {
                  if (artifactType !== "pq-message")
                    throw new AppError("INVALID_QR_PAYLOAD")
                  const envelope = decodeMlKemEnvelopeV2(artifactBytes)
                  const payload = buildV2Payload(
                    "pq-message",
                    encodeMlKemEnvelopeV2(envelope),
                  )
                  setDecryptInput(payload)
                  setDecrypted(null)
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
          {decryptKeyMissing && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>KEY_NOT_FOUND</AlertTitle>
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
        open={decrypted !== null && decrypted.kind !== "signed-key-unknown"}
        onOpenChange={(open) => {
          if (!open) setDecrypted(null)
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
              </>
            )}
          </div>
        </NoAutofocusDialogContent>
      </Dialog>
    </section>
  )
}
