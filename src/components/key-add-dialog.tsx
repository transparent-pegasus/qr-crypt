import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useFeatureSupport } from "@/app/providers"
import { BundleConfirmView } from "@/components/key-add/bundle-confirm-view"
import {
  CreateKeyView,
  type CreateKeyType,
} from "@/components/key-add/create-key-view"
import { ImportSourceView } from "@/components/key-add/import-source-view"
import { SymmetricImportView } from "@/components/key-add/symmetric-import-view"
import {
  KeyDetailContent,
  type KeyDetailContentProps,
  type KeySelection,
} from "@/components/key-detail-dialog"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AppError, toAppError } from "@/crypto/errors"
import {
  createSymmetricKeyRecord,
  importSymmetricKeyRecordV2,
} from "@/crypto/key-generation"
import {
  decodePublicIdentityBundleV2,
  decodeSymmetricKeyEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import { createIdentity } from "@/crypto/pq/identity"
import { ACTIVE_PROFILE, assertActiveSuite, resolveSuite } from "@/crypto/pq/suites"
import { validateSymmetricKeyEnvelopeV2 } from "@/crypto/pq/validation"
import { pqIdentityFingerprint, pqKeyFingerprint } from "@/crypto/pq/wire-bytes"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { generateKeyId } from "@/crypto/random"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import { formatSuggestedDate } from "@/features/presentation"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePreferences } from "@/hooks/use-preferences"
import {
  messageKeyOrFallback,
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"
import { decodePayload } from "@/qr/decode-artifact"
import type {
  PqPublicBundleRecord,
  PublicIdentityBundleV2,
  StoredKeyRecord,
} from "@/schemas/domain"
import { keyNameSchema } from "@/schemas/key-schema"
import { withSensitiveWriteLock } from "@/storage/database"
import { saveKeyRecord, writeKeyRecord } from "@/storage/key-repository"
import { confirmBundleFingerprint, saveBundle } from "@/storage/pq-bundle-repository"
import { saveIdentity } from "@/storage/pq-identity-repository"

export type KeyAddMode = "create" | "import"

type AddView =
  | { kind: "create" }
  | { kind: "import" }
  | { kind: "symmetric-import"; record: StoredKeyRecord }
  | { kind: "bundle-confirm"; bundle: PqPublicBundleRecord }

type KeyAddDetail = Omit<
  KeyDetailContentProps,
  "open" | "fullscreenOpen" | "onFullscreenOpenChange"
>

interface KeyAddDialogProps {
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

export function KeyAddDialog({
  mode,
  detail,
  onOpenChange,
  onCreated,
  onImported,
}: KeyAddDialogProps) {
  const { t } = useI18n()
  const { camera } = useFeatureSupport()
  const { preferences } = usePreferences()
  const getPqClient = usePqCryptoClient()
  const [view, setView] = useState<AddView>({ kind: mode ?? "create" })
  const [openedAs, setOpenedAs] = useState<KeyAddMode | null>(mode)
  // Follow the configured default algorithm unless the user explicitly selects a kind.
  const [createKindOverride, setCreateKindOverride] = useState<CreateKeyType | null>(null)
  const createKind: CreateKeyType =
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
  // A React state flag is not a commit boundary: setPersisting only schedules a
  // render, and the dismiss handlers keep reading the previous render's value
  // until it paints. The ref is what the handlers check; the state exists only so
  // the close button and the Escape/outside handlers re-render.
  const persistingRef = useRef(false)
  const [persisting, setPersisting] = useState(false)
  const scanSession = useMemo(
    () => new MultipartScanSession(preferences.transferTimeoutMinutes),
    [preferences.transferTimeoutMinutes],
  )

  const open = mode !== null
  const showsDetail = detail !== null
  const abandoned = (opening: number) => openingRef.current !== opening
  // The fingerprint step is a security confirmation: leaving it by dismissing the
  // modal would save nothing, so this one view refuses every dismiss path. A write
  // in flight refuses them too: dismissing there tells the user the creation was
  // cancelled and hands them the key anyway.
  const locked = view.kind === "bundle-confirm" || persisting

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
      setPersisting(false)
    }
  }

  useEffect(() => () => scanSession.discard(), [scanSession])

  // Opening or closing abandons whatever was running: this component outlives the
  // modal, so a continuation that survives a close must not write over the next
  // opening's state, and abandoned frames must not sit in the assembler.
  // The dismiss gate goes with it: a write the parent closed the modal over keeps
  // running, but it belongs to the abandoned opening and must not lock the next one.
  useEffect(() => {
    openingRef.current += 1
    persistingRef.current = false
    return () => {
      openingRef.current += 1
    }
  }, [mode])
  useEffect(() => {
    if (mode === null) scanSession.discard()
  }, [mode, scanSession])

  const persist = async (write: () => Promise<void>) => {
    const opening = openingRef.current
    persistingRef.current = true
    setPersisting(true)
    try {
      await write()
    } finally {
      if (!abandoned(opening)) {
        persistingRef.current = false
        setPersisting(false)
      }
    }
  }

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
      // The lock spans generation, not just the write: a key that is already
      // generated and certain to be written must not be invisible to boot's
      // clean-origin proof, and this continuation survives the Router unmount that
      // going online performs. writeKeyRecord is the unlocked writer, because Web
      // Locks has no reentrancy.
      let created: StoredKeyRecord | undefined
      await withSensitiveWriteLock(async () => {
        const record = await createSymmetricKeyRecord(parsed.data, Date.now())
        if (abandoned(opening)) return
        await persist(() => writeKeyRecord(record))
        created = record
      })
      if (created === undefined || abandoned(opening)) return
      setKeyName("")
      await onCreated({ kind: "symmetric", id: created.id })
      if (abandoned(opening)) return
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
      // No extended span here: getOrCreateVaultKey persists the vault key under the
      // sensitive-write lock before the Worker keygen begins, and boot counts a
      // vault key as sensitive data, so the origin is already provably dirty by the
      // time the slow part starts.
      //
      // ponytail: that write survives a modal closed during generation — an orphan
      // vault key with no identity. Preventing it needs an AbortSignal threaded
      // through the Worker and vault creation; until then the residual is
      // fail-closed, since boot reads the orphan as a dirty origin and denies the
      // online relay.
      const vaultKey = await getOrCreateVaultKey()
      if (abandoned(opening)) return
      const identity = await createIdentity({
        client: getPqClient(),
        vaultKey,
        name: parsed.data,
        profile: ACTIVE_PROFILE,
        now: Date.now(),
      })
      if (abandoned(opening)) return
      await persist(() => saveIdentity(identity))
      if (abandoned(opening)) return
      setKeyName("")
      await onCreated({ kind: "identity", id: identity.id })
      if (abandoned(opening)) return
      toast.success(t("keys.toast.identityCreated"))
    } catch (caught) {
      if (abandoned(opening)) return
      setError(toAppError(caught, "ENCRYPTION_FAILED").code)
    } finally {
      if (!abandoned(opening)) setBusy(false)
    }
  }

  // Wire names allow 1-100 unnormalized units; storage requires trimmed 1-80 without
  // controls. An unacceptable label is dropped rather than failing the import after
  // the fingerprint ceremony - the key material, not the label, is the identity.
  const acceptableImportedName = (name: string | undefined): { name?: string } => {
    if (name === undefined) return {}
    const parsed = keyNameSchema.safeParse(name)
    return parsed.success ? { name: parsed.data } : {}
  }

  const prepareBundleImport = async (
    bundle: PublicIdentityBundleV2,
  ): Promise<AddView> => {
    assertUsableBundle(bundle)
    const importedAt = Date.now()
    const [kemFingerprint, signingFingerprint, identityFingerprint] = await Promise.all([
      pqKeyFingerprint("kem", bundle.kem.algorithm, bundle.kem.publicKey),
      pqKeyFingerprint("signing", bundle.signing.algorithm, bundle.signing.publicKey),
      pqIdentityFingerprint(bundle),
    ])
    return {
      kind: "bundle-confirm",
      bundle: {
        recordId: generateKeyId(),
        identityId: bundle.identityId,
        ...acceptableImportedName(bundle.name),
        kem: { ...bundle.kem, fingerprint: kemFingerprint },
        signing: { ...bundle.signing, fingerprint: signingFingerprint },
        identityFingerprint,
        trust: "unverified",
        bundleCreatedAt: bundle.createdAt,
        importedAt,
      },
    }
  }

  const showPreparedImport = (nextView: AddView) => {
    setFingerprintChecked(false)
    setSymmetricImportName(
      nextView.kind === "symmetric-import" ? nextView.record.name : "",
    )
    setSymmetricImportAcknowledged(false)
    setView(nextView)
  }

  const symmetricImportDefaultName = () =>
    t("keys.import.symmetricDefaultName", {
      date: formatSuggestedDate(Date.now()),
    })

  const prepareImport = async (
    decoded: ReturnType<typeof decodePayload>,
  ): Promise<AddView> => {
    switch (decoded.kind) {
      case "symmetric-key": {
        const record = await importSymmetricKeyRecordV2(
          symmetricImportDefaultName(),
          decoded.envelope,
          Date.now(),
        )
        return { kind: "symmetric-import", record }
      }
      case "pq-public-identity":
        return prepareBundleImport(decoded.envelope)
      default:
        throw new AppError("INVALID_QR_PAYLOAD")
    }
  }

  const importPastedPayload = async () => {
    const opening = openingRef.current
    setBusy(true)
    setError(null)
    try {
      const nextView = await prepareImport(decodePayload(importPayload.trim()))
      if (abandoned(opening)) return
      showPreparedImport(nextView)
      setImportPayload("")
    } catch (caught) {
      if (abandoned(opening)) return
      setError(toAppError(caught, "INVALID_QR_PAYLOAD").code)
    } finally {
      if (!abandoned(opening)) setBusy(false)
    }
  }

  const handleCompletedArtifact = async (args: {
    artifactType: string
    artifactBytes: Uint8Array
  }) => {
    const opening = openingRef.current
    // The decoders copy what they need, so release the assembler's own copy of the
    // delivered artifact only while this opening still owns the scan session.
    try {
      let decoded: ReturnType<typeof decodePayload>
      if (args.artifactType === "pq-public-identity") {
        decoded = {
          kind: "pq-public-identity",
          envelope: decodePublicIdentityBundleV2(args.artifactBytes),
        }
      } else if (args.artifactType === "symmetric-key") {
        decoded = {
          kind: "symmetric-key",
          envelope: validateSymmetricKeyEnvelopeV2(
            decodeSymmetricKeyEnvelopeV2(args.artifactBytes),
          ),
        }
      } else {
        throw new AppError("INVALID_QR_PAYLOAD")
      }
      const nextView = await prepareImport(decoded)
      if (abandoned(opening)) return
      showPreparedImport(nextView)
    } catch (caught) {
      if (abandoned(opening)) return
      throw caught
    } finally {
      if (!abandoned(opening)) scanSession.discard()
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
      await persist(() => saveKeyRecord({ ...view.record, name: parsedName.data }))
      if (abandoned(opening)) return
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

  // No persist() here, unlike the import above: this view is already locked by
  // its kind, and a public bundle is not sensitive data — boot never scans it.
  const savePendingBundle = async (confirmed: boolean) => {
    if (view.kind !== "bundle-confirm" || (confirmed && !fingerprintChecked)) return
    const opening = openingRef.current
    setBusy(true)
    setError(null)
    try {
      await saveBundle(view.bundle)
      if (abandoned(opening)) return
      if (confirmed) {
        await confirmBundleFingerprint(view.bundle.recordId, Date.now())
        if (abandoned(opening)) return
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

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || locked || persistingRef.current || fullscreenOpen) return
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
            <CreateKeyView
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

          {open && view.kind === "import" && (
            <ImportSourceView
              cameraAvailable={camera}
              scanSession={scanSession}
              importPayload={importPayload}
              busy={busy}
              onComplete={handleCompletedArtifact}
              onPasteChange={setImportPayload}
              onReadPaste={importPastedPayload}
            />
          )}

          {view.kind === "symmetric-import" && (
            <SymmetricImportView
              record={view.record}
              name={symmetricImportName}
              acknowledged={symmetricImportAcknowledged}
              busy={busy}
              onNameChange={setSymmetricImportName}
              onAcknowledgedChange={setSymmetricImportAcknowledged}
              onSave={savePendingSymmetricImport}
            />
          )}

          {view.kind === "bundle-confirm" && (
            <BundleConfirmView
              bundle={view.bundle}
              fingerprintChecked={fingerprintChecked}
              busy={busy}
              onFingerprintCheckedChange={setFingerprintChecked}
              onSave={savePendingBundle}
            />
          )}
        </NoAutofocusDialogContent>
      )}
    </Dialog>
  )
}
