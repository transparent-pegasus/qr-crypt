import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { useFeatureSupport, useSensitiveSession } from "@/app/providers"
import {
  KeyDetailContent,
  type KeyDetailContentProps,
  type KeySelection,
} from "@/components/key-detail-dialog"
import { Fingerprint } from "@/components/fingerprint"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { QrScannerModal } from "@/components/qr-scanner-modal"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { AppError, toAppError } from "@/crypto/errors"
import {
  createSymmetricKeyRecord,
  importSymmetricKeyRecord,
  importSymmetricKeyRecordV2,
} from "@/crypto/key-generation"
import {
  decodeDsaPublicKeyEnvelopeV2,
  decodeKemPublicKeyEnvelopeV2,
  decodePublicIdentityBundleV2,
  decodeSymmetricKeyEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import { createIdentity } from "@/crypto/pq/identity"
import { PQ_PROFILES } from "@/crypto/pq/profiles"
import { ACTIVE_PROFILE, assertActiveSuite, resolveSuite } from "@/crypto/pq/suites"
import { validateSymmetricKeyEnvelopeV2 } from "@/crypto/pq/validation"
import { pqIdentityFingerprint, pqKeyFingerprint } from "@/crypto/pq/wire-bytes"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { generateKeyId } from "@/crypto/random"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import {
  ALGORITHM_LABELS,
  formatSuggestedDate,
} from "@/features/presentation"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePreferences } from "@/hooks/use-preferences"
import {
  messageKeyOrFallback,
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"
import { cn } from "@/lib/utils"
import { decodePayload } from "@/qr/payload"
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  PqPublicBundleRecord,
  PublicIdentityBundleV2,
  StoredKeyRecord,
} from "@/schemas/domain"
import { keyNameSchema } from "@/schemas/key-schema"
import { saveKeyRecord } from "@/storage/key-repository"
import { confirmBundleFingerprint, saveBundle } from "@/storage/pq-bundle-repository"
import { saveIdentity } from "@/storage/pq-identity-repository"

export type KeyAddMode = "create" | "import"

type CreateKeyKind = "pq-identity" | "symmetric"

type SingleKeyRead = KemPublicKeyEnvelopeV2 | DsaPublicKeyEnvelopeV2

type AddView =
  | { kind: "create" }
  | { kind: "import" }
  | { kind: "single-key"; envelope: SingleKeyRead; fingerprint: string }
  | { kind: "symmetric-import"; record: StoredKeyRecord }
  | { kind: "bundle-confirm"; bundle: PqPublicBundleRecord }

export type KeyAddDetail = Omit<
  KeyDetailContentProps,
  "open" | "fullscreenOpen" | "onFullscreenOpenChange"
>

export interface KeyAddDialogProps {
  mode: KeyAddMode | null
  /** Set once a key has just been created, to swap this modal over to its detail. */
  detail: KeyAddDetail | null
  onOpenChange: (open: boolean) => void
  onCreated: (selection: KeySelection) => Promise<void>
  onImported: () => Promise<void>
}

function assertUsableBundle(bundle: PublicIdentityBundleV2 | PqPublicBundleRecord): void {
  assertActiveSuite(resolveSuite(bundle.kem.algorithm, bundle.signing.algorithm))
}

function assertUsableSingleKey(envelope: SingleKeyRead): void {
  const suite =
    envelope.type === "pq-kem-public-key"
      ? resolveSuite(envelope.algorithm)
      : resolveSuite(PQ_PROFILES[ACTIVE_PROFILE].kem.algorithm, envelope.algorithm)
  assertActiveSuite(suite)
}

export function KeyAddDialog({
  mode,
  detail,
  onOpenChange,
  onCreated,
  onImported,
}: KeyAddDialogProps) {
  const { t } = useI18n()
  const { camera } = useFeatureSupport()
  const { setSensitiveSession } = useSensitiveSession()
  const { preferences } = usePreferences()
  const getPqClient = usePqCryptoClient()
  const [view, setView] = useState<AddView>({ kind: mode ?? "create" })
  const [openedAs, setOpenedAs] = useState<KeyAddMode | null>(mode)
  // Follow the configured default algorithm unless the user explicitly selects a kind.
  const [createKindOverride, setCreateKindOverride] = useState<CreateKeyKind | null>(null)
  const createKind: CreateKeyKind =
    createKindOverride ??
    (preferences.defaultAlgorithm === "A256GCM" ? "symmetric" : "pq-identity")
  const [keyName, setKeyName] = useState("")
  const [importPayload, setImportPayload] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(error)
  const [fingerprintChecked, setFingerprintChecked] = useState(false)
  const [symmetricImportName, setSymmetricImportName] = useState("")
  const [symmetricImportAcknowledged, setSymmetricImportAcknowledged] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const openingRef = useRef(0)
  const scanSession = useMemo(
    () => new MultipartScanSession(preferences.transferTimeoutMinutes),
    [preferences.transferTimeoutMinutes],
  )

  const open = mode !== null
  const showsDetail = detail !== null
  const abandoned = (opening: number) => openingRef.current !== opening
  // The fingerprint step is a security confirmation: leaving it by dismissing the
  // modal would save nothing, so this one view refuses every dismiss path.
  const locked = view.kind === "bundle-confirm"

  // Each opening starts from a clean modal. Adjusting during render rather than in
  // an effect keeps the first paint of a reopened modal from showing the old view.
  if (mode !== openedAs) {
    setOpenedAs(mode)
    if (mode !== null) {
      setView({ kind: mode })
      setKeyName("")
      setImportPayload("")
      setCreateKindOverride(null)
      setError(null)
      setFingerprintChecked(false)
      setSymmetricImportName("")
      setSymmetricImportAcknowledged(false)
      setBusy(false)
    }
  }

  useEffect(() => () => scanSession.discard(), [scanSession])

  // Opening or closing abandons whatever was running: this component outlives the
  // modal, so a continuation that survives a close must not write over the next
  // opening's state, and abandoned frames must not sit in the assembler.
  useEffect(() => {
    openingRef.current += 1
  }, [mode])
  useEffect(() => {
    if (mode === null) scanSession.discard()
  }, [mode, scanSession])

  useEffect(() => {
    if (showsDetail) return
    setSensitiveSession({
      cryptoBusy: open && busy,
      secretVisible: open && view.kind === "symmetric-import",
    })
  }, [busy, open, setSensitiveSession, showsDetail, view.kind])
  useEffect(
    () => () => {
      setSensitiveSession({ cryptoBusy: false, secretVisible: false })
    },
    [setSensitiveSession],
  )

  const createSymmetric = async () => {
    const parsed = keyNameSchema.safeParse(keyName)
    if (!parsed.success) {
      setError(
        messageKeyOrFallback(
          parsed.error.issues[0]?.message,
          "keys.validation.keyNameFallback",
        ),
      )
      return
    }
    const opening = openingRef.current
    setBusy(true)
    setError(null)
    try {
      const record = await createSymmetricKeyRecord(parsed.data, Date.now())
      await saveKeyRecord(record)
      if (abandoned(opening)) return
      setKeyName("")
      await onCreated({ kind: "symmetric", id: record.id })
      toast.success(t("keys.toast.symmetricCreated"))
    } catch (caught) {
      if (abandoned(opening)) return
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      if (!abandoned(opening)) setBusy(false)
    }
  }

  const createPqIdentity = async () => {
    const parsed = keyNameSchema.safeParse(keyName)
    if (!parsed.success) {
      setError(
        messageKeyOrFallback(
          parsed.error.issues[0]?.message,
          "keys.validation.idNameFallback",
        ),
      )
      return
    }
    const opening = openingRef.current
    setBusy(true)
    setError(null)
    try {
      const identity = await createIdentity({
        client: getPqClient(),
        vaultKey: await getOrCreateVaultKey(),
        name: parsed.data,
        profile: ACTIVE_PROFILE,
        now: Date.now(),
      })
      await saveIdentity(identity)
      if (abandoned(opening)) return
      setKeyName("")
      await onCreated({ kind: "identity", id: identity.id })
      toast.success(t("keys.toast.identityCreated"))
    } catch (caught) {
      if (abandoned(opening)) return
      setError(toAppError(caught, "ENCRYPTION_FAILED").code)
    } finally {
      if (!abandoned(opening)) setBusy(false)
    }
  }

  const prepareBundleImport = async (bundle: PublicIdentityBundleV2) => {
    assertUsableBundle(bundle)
    const importedAt = Date.now()
    const [kemFingerprint, signingFingerprint, identityFingerprint] = await Promise.all([
      pqKeyFingerprint("kem", bundle.kem.algorithm, bundle.kem.publicKey),
      pqKeyFingerprint("signing", bundle.signing.algorithm, bundle.signing.publicKey),
      pqIdentityFingerprint(bundle),
    ])
    setFingerprintChecked(false)
    setView({
      kind: "bundle-confirm",
      bundle: {
        recordId: generateKeyId(),
        identityId: bundle.identityId,
        ...(bundle.name === undefined ? {} : { name: bundle.name }),
        kem: { ...bundle.kem, fingerprint: kemFingerprint },
        signing: { ...bundle.signing, fingerprint: signingFingerprint },
        identityFingerprint,
        trust: "unverified",
        bundleCreatedAt: bundle.createdAt,
        importedAt,
      },
    })
  }

  const handleSingleKey = async (envelope: SingleKeyRead) => {
    assertUsableSingleKey(envelope)
    const fingerprint =
      envelope.type === "pq-kem-public-key"
        ? await pqKeyFingerprint("kem", envelope.algorithm, envelope.publicKey)
        : await pqKeyFingerprint("signing", envelope.algorithm, envelope.publicKey)
    setView({ kind: "single-key", envelope, fingerprint })
  }

  const beginSymmetricImport = (record: StoredKeyRecord) => {
    setSymmetricImportName(record.name)
    setSymmetricImportAcknowledged(false)
    setView({ kind: "symmetric-import", record })
  }

  const symmetricImportDefaultName = () =>
    t("keys.import.symmetricDefaultName", {
      date: formatSuggestedDate(Date.now()),
    })

  const importDecoded = async (
    decoded: ReturnType<typeof decodePayload>,
    opening: number,
  ) => {
    if (abandoned(opening)) return
    switch (decoded.kind) {
      case "symmetric-key": {
        const record =
          "v" in decoded.envelope
            ? await importSymmetricKeyRecord(
                symmetricImportDefaultName(),
                decoded.envelope,
                Date.now(),
              )
            : await importSymmetricKeyRecordV2(
                symmetricImportDefaultName(),
                decoded.envelope,
                Date.now(),
              )
        beginSymmetricImport(record)
        return
      }
      case "pq-public-identity":
        await prepareBundleImport(decoded.envelope)
        return
      case "pq-kem-public-key":
      case "pq-dsa-public-key":
        await handleSingleKey(decoded.envelope)
        return
      default:
        throw new AppError("INVALID_QR_PAYLOAD")
    }
  }

  const importPastedPayload = async () => {
    const opening = openingRef.current
    setBusy(true)
    setError(null)
    try {
      await importDecoded(decodePayload(importPayload.trim()), opening)
      if (abandoned(opening)) return
      setImportPayload("")
    } catch (caught) {
      if (abandoned(opening)) return
      setError(toAppError(caught, "INVALID_QR_PAYLOAD").code)
    } finally {
      if (!abandoned(opening)) setBusy(false)
    }
  }

  const importScannedPayload = async (payload: string) => {
    const opening = openingRef.current
    setBusy(true)
    setError(null)
    try {
      await importDecoded(decodePayload(payload), opening)
    } finally {
      if (!abandoned(opening)) setBusy(false)
    }
  }

  const handleCompletedArtifact = async (args: {
    artifactType: string
    artifactBytes: Uint8Array
  }) => {
    // The decoders copy what they need, so release the assembler's own copy of the
    // delivered artifact and leave the session ready for the next transfer.
    try {
      if (args.artifactType === "pq-public-identity") {
        await prepareBundleImport(decodePublicIdentityBundleV2(args.artifactBytes))
        return
      }
      if (args.artifactType === "pq-kem-public-key") {
        await handleSingleKey(decodeKemPublicKeyEnvelopeV2(args.artifactBytes))
        return
      }
      if (args.artifactType === "pq-dsa-public-key") {
        await handleSingleKey(decodeDsaPublicKeyEnvelopeV2(args.artifactBytes))
        return
      }
      if (args.artifactType === "symmetric-key") {
        const envelope = validateSymmetricKeyEnvelopeV2(
          decodeSymmetricKeyEnvelopeV2(args.artifactBytes),
        )
        beginSymmetricImport(
          await importSymmetricKeyRecordV2(
            symmetricImportDefaultName(),
            envelope,
            Date.now(),
          ),
        )
        return
      }
      throw new AppError("INVALID_QR_PAYLOAD")
    } finally {
      scanSession.discard()
    }
  }

  const savePendingSymmetricImport = async () => {
    if (view.kind !== "symmetric-import" || !symmetricImportAcknowledged) return
    const parsedName = keyNameSchema.safeParse(symmetricImportName)
    if (!parsedName.success) {
      setError(
        messageKeyOrFallback(
          parsedName.error.issues[0]?.message,
          "keys.validation.keyNameFallback",
        ),
      )
      return
    }
    const opening = openingRef.current
    setBusy(true)
    setError(null)
    try {
      await saveKeyRecord({ ...view.record, name: parsedName.data })
      await onImported()
      if (abandoned(opening)) return
      toast.success(t("keys.toast.symmetricImported"))
      onOpenChange(false)
    } catch (caught) {
      if (abandoned(opening)) return
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      if (!abandoned(opening)) setBusy(false)
    }
  }

  const savePendingBundle = async (confirmed: boolean) => {
    if (view.kind !== "bundle-confirm" || (confirmed && !fingerprintChecked)) return
    const opening = openingRef.current
    setBusy(true)
    setError(null)
    try {
      await saveBundle(view.bundle)
      if (confirmed) {
        await confirmBundleFingerprint(view.bundle.recordId, Date.now())
      }
      await onImported()
      if (abandoned(opening)) return
      toast.success(
        t(confirmed ? "keys.toast.bundleConfirmed" : "keys.toast.bundleUnverified"),
      )
      onOpenChange(false)
    } catch (caught) {
      if (abandoned(opening)) return
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      if (!abandoned(opening)) setBusy(false)
    }
  }

  const backToImport = () => {
    setView({ kind: "import" })
    setError(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || locked || fullscreenOpen) return
        onOpenChange(false)
      }}
    >
      {showsDetail ? (
        <KeyDetailContent
          {...detail}
          open={open}
          fullscreenOpen={fullscreenOpen}
          onFullscreenOpenChange={setFullscreenOpen}
        />
      ) : (
        <NoAutofocusDialogContent
          className="max-h-[95dvh] max-w-lg overflow-y-auto"
          aria-busy={busy}
          hideCloseButton={locked}
          {...(locked
            ? {
                onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
                onPointerDownOutside: (event: Event) => event.preventDefault(),
              }
            : {})}
        >
          <DialogHeader>
            <DialogTitle className={locked ? undefined : "sr-only"}>
              {view.kind === "bundle-confirm"
                ? t("keys.bundle.dialogTitle")
                : view.kind === "symmetric-import"
                  ? t("keys.symmetricImport.dialogTitle")
                  : view.kind === "create"
                    ? t("keys.tab.create")
                    : t("keys.tab.import")}
            </DialogTitle>
            {view.kind === "bundle-confirm" && (
              <DialogDescription>{t("keys.bundle.dialogDesc")}</DialogDescription>
            )}
            {view.kind === "symmetric-import" && (
              <DialogDescription>
                {t("keys.symmetricImport.dialogDesc")}
              </DialogDescription>
            )}
          </DialogHeader>

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>{t("common.operationFailed")}</AlertTitle>
              <AlertDescription>{localizedError}</AlertDescription>
            </Alert>
          )}

          {view.kind === "create" && (
            <CreateField
              kind={createKind}
              onKindChange={setCreateKindOverride}
              value={keyName}
              onChange={setKeyName}
              busy={busy}
              onCreate={() =>
                void (createKind === "pq-identity" ? createPqIdentity() : createSymmetric())
              }
            />
          )}

          {view.kind === "import" && (
            <div className="space-y-4">
              <Card aria-labelledby="camera-import-title">
                <CardHeader className="p-4 pb-3">
                  <h3
                    id="camera-import-title"
                    className="font-semibold leading-none tracking-tight"
                  >
                    {t("keys.import.cameraTitle")}
                  </h3>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-0">
                  <p className="text-sm text-muted-foreground">{t("keys.demo.hint")}</p>
                  <QrScannerModal
                    triggerLabel={t("keys.import.scanTrigger")}
                    singleTargets={["symmetric-key"]}
                    cameraAvailable={camera}
                    title={t("keys.import.scanTrigger")}
                    onSingleScan={(_target, payload) => importScannedPayload(payload)}
                    multipart={{
                      session: scanSession,
                      onComplete: (completion) => handleCompletedArtifact(completion),
                    }}
                  />
                </CardContent>
              </Card>
              <Card aria-labelledby="paste-import-title">
                <CardHeader className="p-4 pb-3">
                  <h3
                    id="paste-import-title"
                    className="font-semibold leading-none tracking-tight"
                  >
                    {t("common.pastePayload")}
                  </h3>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="space-y-2">
                    <Label htmlFor="key-payload">{t("keys.import.payloadLabel")}</Label>
                    <Textarea
                      id="key-payload"
                      value={importPayload}
                      onChange={(event) => setImportPayload(event.target.value)}
                      placeholder={t("keys.import.payloadPlaceholder")}
                      className="min-h-28 break-all font-mono"
                    />
                    <Button
                      type="button"
                      className="h-11 w-full"
                      disabled={busy || !importPayload.trim()}
                      onClick={() => void importPastedPayload()}
                    >
                      <KeyRound aria-hidden="true" />
                      {t("keys.import.readButton")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {view.kind === "single-key" && (
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 aria-hidden="true" className="size-4" />
                <AlertTitle>{t("keys.singleKey.title")}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    {view.envelope.type === "pq-kem-public-key"
                      ? t("keys.singleKey.kemLabel")
                      : t("keys.singleKey.signingLabel")}{" "}
                    / {view.envelope.algorithm}
                  </p>
                  <Fingerprint
                    label={t("keys.singleKey.fingerprintLabel")}
                    value={view.fingerprint}
                  />
                  <p>{t("keys.singleKey.persistHint")}</p>
                </AlertDescription>
              </Alert>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-fit"
                onClick={backToImport}
              >
                <ArrowLeft aria-hidden="true" />
                {t("keyDetail.backToDetail")}
              </Button>
            </div>
          )}

          {view.kind === "symmetric-import" && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTitle>{t("keys.symmetricImport.warnTitle")}</AlertTitle>
                <AlertDescription>{t("keys.symmetricImport.warnBody")}</AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="symmetric-import-name">
                  {t("keys.symmetricImport.nameLabel")}
                </Label>
                <Input
                  id="symmetric-import-name"
                  value={symmetricImportName}
                  maxLength={80}
                  onChange={(event) => setSymmetricImportName(event.target.value)}
                />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="symmetric-import-ack"
                  checked={symmetricImportAcknowledged}
                  onCheckedChange={(checked) =>
                    setSymmetricImportAcknowledged(checked === true)
                  }
                />
                <Label htmlFor="symmetric-import-ack">
                  {t("keys.symmetricImport.ackLabel")}
                </Label>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  disabled={busy || !symmetricImportAcknowledged}
                  onClick={() => void savePendingSymmetricImport()}
                >
                  {t("keys.symmetricImport.saveButton")}
                </Button>
              </DialogFooter>
            </div>
          )}

          {view.kind === "bundle-confirm" && (
            <div className="space-y-4">
              <Fingerprint
                label={t("common.identityFingerprint")}
                value={view.bundle.identityFingerprint}
              />
              <Fingerprint
                label={t("keys.bundle.fingerprintKem")}
                value={view.bundle.kem.fingerprint}
              />
              <Fingerprint
                label={t("keys.bundle.fingerprintSigning")}
                value={view.bundle.signing.fingerprint}
              />
              <div className="flex items-start gap-2">
                <Checkbox
                  id="fingerprint-confirmed"
                  checked={fingerprintChecked}
                  onCheckedChange={(checked) => setFingerprintChecked(checked === true)}
                />
                <Label htmlFor="fingerprint-confirmed">
                  {t("keys.bundle.confirmLabel")}
                </Label>
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void savePendingBundle(false)}
                >
                  {t("keys.bundle.saveUnverified")}
                </Button>
                <Button
                  type="button"
                  disabled={busy || !fingerprintChecked}
                  onClick={() => void savePendingBundle(true)}
                >
                  {t("keys.bundle.saveConfirmed")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </NoAutofocusDialogContent>
      )}
    </Dialog>
  )
}

function CreateField({
  kind,
  onKindChange,
  value,
  onChange,
  busy,
  onCreate,
}: {
  kind: CreateKeyKind
  onKindChange: (kind: CreateKeyKind) => void
  value: string
  onChange: (value: string) => void
  busy: boolean
  onCreate: () => void
}) {
  const { language, t } = useI18n()
  const pq = kind === "pq-identity"
  const nameLabel = t(pq ? "keys.create.nameLabel.pq" : "keys.create.nameLabel.symmetric")
  const buttonLabel = t(pq ? "keys.create.button.pq" : "keys.create.button.symmetric")
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="space-y-2">
          <Label htmlFor="create-key-kind">{t("keys.create.kindLabel")}</Label>
          <Select
            value={kind}
            onValueChange={(value) => onKindChange(value as CreateKeyKind)}
          >
            <SelectTrigger id="create-key-kind" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pq-identity">
                {t("keys.create.kind.pqIdentity")}
              </SelectItem>
              <SelectItem value="symmetric">
                {ALGORITHM_LABELS[language].A256GCM}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Label htmlFor="create-key-name">{nameLabel}</Label>
        <Input
          id="create-key-name"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={80}
        />
        {kind === "pq-identity" && (
          <div
            role="note"
            className={cn(
              buttonVariants({ variant: "outline" }),
              // buttonVariants carries whitespace-nowrap, which pushed this note
              // past the modal's content box on a narrow screen.
              "min-h-11 w-full cursor-default select-text touch-auto whitespace-normal py-2 text-center text-muted-foreground hover:bg-background hover:text-muted-foreground",
            )}
          >
            <ShieldCheck aria-hidden="true" />
            {t("keys.create.experimentalNote")}
          </div>
        )}
        <Button
          type="button"
          className="h-11 w-full"
          disabled={busy || !value.trim()}
          onClick={onCreate}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <KeyRound aria-hidden="true" />
          )}
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  )
}
