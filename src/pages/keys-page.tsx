import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  ScanLine,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { useFeatureSupport, useSensitiveSession } from "@/app/providers"
import {
  KeyDetailDialog,
  type KeySelection,
} from "@/components/key-detail-dialog"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { QrScannerModal } from "@/components/qr-scanner-panel"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { AppError, toAppError } from "@/crypto/errors"
import {
  createSymmetricKeyRecord,
  importSymmetricKeyRecord,
} from "@/crypto/key-generation"
import {
  decodeDsaPublicKeyEnvelopeV2,
  decodeKemPublicKeyEnvelopeV2,
  decodePublicIdentityBundleV2,
} from "@/crypto/pq/canonical-cbor"
import { createIdentity } from "@/crypto/pq/identity"
import { PQ_PROFILES } from "@/crypto/pq/profiles"
import { ACTIVE_PROFILE, assertActiveSuite, resolveSuite } from "@/crypto/pq/suites"
import { pqIdentityFingerprint, pqKeyFingerprint } from "@/crypto/pq/wire-bytes"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { generateKeyId } from "@/crypto/random"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import {
  ALGORITHM_LABELS,
  formatFingerprint,
  formatSuggestedDate,
} from "@/features/presentation"
import { useKeys } from "@/hooks/use-keys"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePqRecords } from "@/hooks/use-pq-records"
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
  PostQuantumIdentity,
  PqPublicBundleRecord,
  PublicIdentityBundleV2,
  StoredKeyRecord,
} from "@/schemas/domain"
import { keyNameSchema } from "@/schemas/key-schema"
import { deleteKeyRecord, saveKeyRecord } from "@/storage/key-repository"
import {
  confirmBundleFingerprint,
  saveBundle,
} from "@/storage/pq-bundle-repository"
import { saveIdentity } from "@/storage/pq-identity-repository"

type KeysTab = "create" | "import"
type CreateKeyKind = "pq-identity" | "symmetric"

type SingleKeyRead = KemPublicKeyEnvelopeV2 | DsaPublicKeyEnvelopeV2

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

export function KeysPage() {
  const { t } = useI18n()
  const { camera } = useFeatureSupport()
  const { setSensitiveSession } = useSensitiveSession()
  const { preferences } = usePreferences()
  const { keys, loading: keysLoading, error: keysError, refresh: refreshKeys } = useKeys()
  const {
    identities,
    loading: pqLoading,
    error: pqError,
    refresh: refreshPq,
  } = usePqRecords()
  const getPqClient = usePqCryptoClient()
  const [tab, setTab] = useState<KeysTab>("create")
  // Follow the configured default algorithm unless the user explicitly selects a kind.
  const [createKindOverride, setCreateKindOverride] = useState<CreateKeyKind | null>(
    null,
  )
  const createKind: CreateKeyKind =
    createKindOverride ??
    (preferences.defaultAlgorithm === "A256GCM" ? "symmetric" : "pq-identity")
  const [keyName, setKeyName] = useState("")
  const [importPayload, setImportPayload] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(error ?? keysError ?? pqError)
  const [selection, setSelection] = useState<KeySelection | null>(null)
  const [pendingBundle, setPendingBundle] = useState<PqPublicBundleRecord | null>(null)
  const [fingerprintChecked, setFingerprintChecked] = useState(false)
  const [singleKeyRead, setSingleKeyRead] = useState<SingleKeyRead | null>(null)
  const [singleKeyFingerprint, setSingleKeyFingerprint] = useState("")
  const [pendingSymmetricImport, setPendingSymmetricImport] =
    useState<StoredKeyRecord | null>(null)
  const [symmetricImportName, setSymmetricImportName] = useState("")
  const [symmetricImportAcknowledged, setSymmetricImportAcknowledged] = useState(false)
  const legacyKeys = useMemo(
    () => keys.filter((key) => key.kind === "rsa-key-pair" || key.kind === "public-key"),
    [keys],
  )
  const scanSession = useMemo(
    () => new MultipartScanSession(preferences.transferTimeoutMinutes),
    [preferences.transferTimeoutMinutes],
  )
  const selectedIdentity =
    selection?.kind === "identity"
      ? identities.find((identity) => identity.id === selection.id)
      : undefined
  const selectedSymmetric =
    selection?.kind === "symmetric"
      ? keys.find((key) => key.kind === "symmetric" && key.id === selection.id)
      : undefined
  const dialogSelection =
    (selection?.kind === "identity" &&
      !pqLoading &&
      selectedIdentity === undefined) ||
    (selection?.kind === "symmetric" &&
      !keysLoading &&
      selectedSymmetric === undefined)
      ? null
      : selection
  const selectedPrevious = useMemo(() => {
    if (!selectedIdentity) return []
    const byId = new Map(identities.map((identity) => [identity.id, identity]))
    const previous: PostQuantumIdentity[] = []
    const visited = new Set([selectedIdentity.id])
    for (let cursor = selectedIdentity.rotatedFromId; cursor !== undefined;) {
      const generation = byId.get(cursor)
      if (generation === undefined || visited.has(generation.id)) break
      visited.add(generation.id)
      previous.push(generation)
      cursor = generation.rotatedFromId
    }
    return previous
  }, [identities, selectedIdentity])

  useEffect(() => {
    setSensitiveSession({
      cryptoBusy: busy,
      secretVisible: pendingSymmetricImport !== null,
    })
  }, [busy, pendingSymmetricImport, setSensitiveSession])
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
    setBusy(true)
    setError(null)
    try {
      const record = await createSymmetricKeyRecord(parsed.data, Date.now())
      await saveKeyRecord(record)
      setKeyName("")
      await refreshKeys()
      setSelection({ kind: "symmetric", id: record.id })
      toast.success(t("keys.toast.symmetricCreated"))
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
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
      setKeyName("")
      await refreshPq()
      setSelection({ kind: "identity", id: identity.id })
      toast.success(t("keys.toast.identityCreated"))
    } catch (caught) {
      setError(toAppError(caught, "ENCRYPTION_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const removeLegacyKeys = async () => {
    setBusy(true)
    setError(null)
    try {
      await Promise.all(legacyKeys.map((key) => deleteKeyRecord(key.id)))
      await refreshKeys()
      toast.success(t("keys.toast.legacyRemoved"))
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
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
    setPendingBundle({
      recordId: generateKeyId(),
      identityId: bundle.identityId,
      ...(bundle.name === undefined ? {} : { name: bundle.name }),
      kem: { ...bundle.kem, fingerprint: kemFingerprint },
      signing: { ...bundle.signing, fingerprint: signingFingerprint },
      identityFingerprint,
      trust: "unverified",
      bundleCreatedAt: bundle.createdAt,
      importedAt,
    })
  }

  const handleSingleKey = async (envelope: SingleKeyRead) => {
    assertUsableSingleKey(envelope)
    const fingerprint =
      envelope.type === "pq-kem-public-key"
        ? await pqKeyFingerprint("kem", envelope.algorithm, envelope.publicKey)
        : await pqKeyFingerprint("signing", envelope.algorithm, envelope.publicKey)
    setSingleKeyRead(envelope)
    setSingleKeyFingerprint(fingerprint)
  }

  const importDecoded = async (decoded: ReturnType<typeof decodePayload>) => {
    switch (decoded.kind) {
      case "symmetric-key": {
        const record = await importSymmetricKeyRecord(
          t("keys.import.symmetricDefaultName", {
            date: formatSuggestedDate(Date.now()),
          }),
          decoded.envelope,
          Date.now(),
        )
        setPendingSymmetricImport(record)
        setSymmetricImportName(record.name)
        setSymmetricImportAcknowledged(false)
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
    setBusy(true)
    setError(null)
    try {
      await importDecoded(decodePayload(importPayload.trim()))
      setImportPayload("")
    } catch (caught) {
      setError(toAppError(caught, "INVALID_QR_PAYLOAD").code)
    } finally {
      setBusy(false)
    }
  }

  const importScannedPayload = async (payload: string) => {
    setBusy(true)
    setError(null)
    try {
      await importDecoded(decodePayload(payload))
    } finally {
      setBusy(false)
    }
  }

  const savePendingSymmetricImport = async () => {
    if (!pendingSymmetricImport || !symmetricImportAcknowledged) return
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
    setBusy(true)
    setError(null)
    try {
      await saveKeyRecord({ ...pendingSymmetricImport, name: parsedName.data })
      setPendingSymmetricImport(null)
      setSymmetricImportName("")
      setSymmetricImportAcknowledged(false)
      await refreshKeys()
      toast.success(t("keys.toast.symmetricImported"))
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const savePendingBundle = async (confirmed: boolean) => {
    if (!pendingBundle || (confirmed && !fingerprintChecked)) return
    setBusy(true)
    setError(null)
    try {
      await saveBundle(pendingBundle)
      if (confirmed) {
        await confirmBundleFingerprint(pendingBundle.recordId, Date.now())
      }
      setPendingBundle(null)
      setFingerprintChecked(false)
      await refreshPq()
      toast.success(
        t(confirmed ? "keys.toast.bundleConfirmed" : "keys.toast.bundleUnverified"),
      )
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const handleCompletedArtifact = async (args: {
    artifactType: string
    artifactBytes: Uint8Array
  }) => {
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
    throw new AppError("INVALID_QR_PAYLOAD")
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6" aria-busy={busy}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[1.375rem] font-bold tracking-tight">
          {t("keys.title")}
        </h2>
        {(keysLoading || pqLoading || busy) && (
          <LoaderCircle
            aria-label={t("common.processing")}
            className="size-5 animate-spin"
          />
        )}
      </div>

      {legacyKeys.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>
            {t("keys.legacy.title", { count: legacyKeys.length })}
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{t("keys.legacy.body")}</p>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void removeLegacyKeys()}
            >
              <Trash2 aria-hidden="true" />
              {t("keys.legacy.deleteButton")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {(error || keysError || pqError) && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("common.operationFailed")}</AlertTitle>
          <AlertDescription>{localizedError}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as KeysTab)}>
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="create" className="h-9 cursor-pointer px-1 text-sm">
            {t("keys.tab.create")}
          </TabsTrigger>
          <TabsTrigger value="import" className="h-9 cursor-pointer px-1 text-sm">
            {t("keys.tab.import")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="mt-6 space-y-4">
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
        </TabsContent>

        <TabsContent value="import" className="mt-6 space-y-4">
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
              <DemoKeyQr />
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
                <Label htmlFor="key-payload">
                  {t("keys.import.payloadLabel")}
                </Label>
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
          {singleKeyRead && (
            <Alert>
              <CheckCircle2 aria-hidden="true" className="size-4" />
              <AlertTitle>{t("keys.singleKey.title")}</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  {singleKeyRead.type === "pq-kem-public-key"
                    ? t("keys.singleKey.kemLabel")
                    : t("keys.singleKey.signingLabel")}{" "}
                  / {singleKeyRead.algorithm}
                </p>
                <Fingerprint
                  label={t("keys.singleKey.fingerprintLabel")}
                  value={singleKeyFingerprint}
                />
                <p>{t("keys.singleKey.persistHint")}</p>
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={pendingBundle !== null} onOpenChange={() => undefined}>
        {/* Security confirmation: deliberately not dismissible. */}
        <NoAutofocusDialogContent
          hideCloseButton
          className="max-h-[95dvh] max-w-lg overflow-y-auto"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t("keys.bundle.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("keys.bundle.dialogDesc")}
            </DialogDescription>
          </DialogHeader>
          {pendingBundle && (
            <div className="space-y-4">
              <Fingerprint
                label={t("common.identityFingerprint")}
                value={pendingBundle.identityFingerprint}
              />
              <Fingerprint
                label={t("keys.bundle.fingerprintKem")}
                value={pendingBundle.kem.fingerprint}
              />
              <Fingerprint
                label={t("keys.bundle.fingerprintSigning")}
                value={pendingBundle.signing.fingerprint}
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
            </div>
          )}
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
        </NoAutofocusDialogContent>
      </Dialog>

      <Dialog
        open={pendingSymmetricImport !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSymmetricImport(null)
            setSymmetricImportName("")
            setSymmetricImportAcknowledged(false)
          }
        }}
      >
        <NoAutofocusDialogContent>
          <DialogHeader>
            <DialogTitle>{t("keys.symmetricImport.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("keys.symmetricImport.dialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertTitle>{t("keys.symmetricImport.warnTitle")}</AlertTitle>
            <AlertDescription>
              {t("keys.symmetricImport.warnBody")}
            </AlertDescription>
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
        </NoAutofocusDialogContent>
      </Dialog>

      <KeyDetailDialog
        selection={dialogSelection}
        identity={selectedIdentity}
        previous={selectedPrevious}
        symmetric={selectedSymmetric}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
        onChanged={async (nextSelection) => {
          if (nextSelection.kind === "identity") await refreshPq()
          else await refreshKeys()
          setSelection(nextSelection)
        }}
        />
    </section>
  )
}

function DemoKeyQr() {
  const { t } = useI18n()
  return (
    // The space above the icon is CardHeader pb-3 (12px) + py-3 (12px) = 24px;
    // use gap-6 below it to match that 24px spacing.
    <div className="flex flex-col items-center gap-6 py-3">
      <ScanLine
        aria-hidden="true"
        className="size-32 text-muted-foreground"
      />
      <p className="text-sm text-muted-foreground">
        {t("keys.demo.hint")}
      </p>
    </div>
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
  const nameLabel = t(
    pq ? "keys.create.nameLabel.pq" : "keys.create.nameLabel.symmetric",
  )
  const buttonLabel = t(
    pq ? "keys.create.button.pq" : "keys.create.button.symmetric",
  )
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
              "h-11 w-full cursor-default select-text touch-auto text-muted-foreground hover:bg-background hover:text-muted-foreground",
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

function Fingerprint({ label, value }: { label: string; value: string }) {
  const { t } = useI18n()
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-xs">{value}</p>
      <p className="font-mono text-sm">
        {t("common.fingerprintCompare", { value: formatFingerprint(value) })}
      </p>
    </div>
  )
}
