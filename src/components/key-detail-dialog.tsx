import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ArrowLeft,
  ChevronDown,
  Clipboard,
  Download,
  Expand,
  QrCode,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"
import { useSensitiveSession } from "@/app/providers"
import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { QrDisplay } from "@/components/qr-display"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toAppError } from "@/crypto/errors"
import { buildSymmetricKeyEnvelope } from "@/crypto/key-generation"
import {
  encodeDsaPublicKeyEnvelopeV2,
  encodeKemPublicKeyEnvelopeV2,
  encodePublicIdentityBundleV2,
} from "@/crypto/pq/canonical-cbor"
import { buildPublicBundle, rotateIdentity } from "@/crypto/pq/identity"
import { assertActiveProfile, assertActiveSuite, resolveSuite } from "@/crypto/pq/suites"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import {
  formatDateTime,
  formatFingerprint,
  formatSuggestedDate,
} from "@/features/presentation"
import { useFrameSplit } from "@/hooks/use-frame-split"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePreferences } from "@/hooks/use-preferences"
import {
  messageKeyOrFallback,
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"
import { FRAME_BYTES_MAX, minimumFrameBytesForArtifact } from "@/lib/limits"
import { ecLevelFor } from "@/qr/encode"
import {
  buildExportFileName,
  copyTextToClipboard,
  qrPngBlob,
  triggerDownload,
} from "@/qr/export-image"
import { encodeEnvelopeToPayload } from "@/qr/payload"
import {
  COMPATIBLE_GENERATED_DISPLAY_PAIR,
  DEFAULT_GENERATED_DISPLAY_PAIR,
  type GeneratedDisplayPair,
  type PostQuantumIdentity,
  type Preferences,
  type StoredKeyRecord,
  type StorablePqArtifactKind,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { keyNameSchema } from "@/schemas/key-schema"
import { deleteKeyRecord, renameKeyRecord } from "@/storage/key-repository"
import {
  deleteIdentity,
  deleteSupersededIdentities,
  renameIdentity,
  revokeIdentity,
  saveRotation,
} from "@/storage/pq-identity-repository"

export type KeySelection =
  { kind: "identity"; id: string } | { kind: "symmetric"; id: string }

interface IdentityQrView {
  kind: "identity-qr"
  qrKind: "bundle" | "kem" | "signing"
  targetName: string
  generatedAt: number
  artifactType: StorablePqArtifactKind
  artifactBytes: Uint8Array
  generation: number
}

interface SymmetricQrView {
  kind: "symmetric-qr"
  payload: string
  acknowledged: boolean
}

type DetailView = { kind: "detail" } | IdentityQrView | SymmetricQrView

function selectedGeneratedDisplayPair(
  preferences: Pick<Preferences, "frameBytes" | "frameIntervalMs">,
): GeneratedDisplayPair {
  return preferences.frameBytes === COMPATIBLE_GENERATED_DISPLAY_PAIR.frameBytes &&
    preferences.frameIntervalMs ===
      COMPATIBLE_GENERATED_DISPLAY_PAIR.frameIntervalMs
    ? COMPATIBLE_GENERATED_DISPLAY_PAIR
    : DEFAULT_GENERATED_DISPLAY_PAIR
}

interface PendingDelete {
  kind: "identity" | "symmetric"
  id: string
  name: string
}

export interface KeyDetailDialogProps {
  selection: KeySelection | null
  identity: PostQuantumIdentity | undefined
  previous: PostQuantumIdentity[] | undefined
  symmetric: StoredKeyRecord | undefined
  onOpenChange: (open: boolean) => void
  onChanged: (selection: KeySelection) => Promise<void>
}

// The detail view renders inside a Dialog root owned by the caller so that a
// modal already open for another purpose can switch to it without unmounting
// its overlay. `fullscreenOpen` lives with that caller because the same flag
// gates both this content's inert state and the root's dismiss handler.
export interface KeyDetailContentProps
  extends Omit<KeyDetailDialogProps, "onOpenChange"> {
  open: boolean
  fullscreenOpen: boolean
  onFullscreenOpenChange: (open: boolean) => void
}

export function resolveKeyDetailRecord(
  selection: KeySelection | null,
  identity: PostQuantumIdentity | undefined,
  symmetric: StoredKeyRecord | undefined,
): PostQuantumIdentity | StoredKeyRecord | undefined {
  if (selection?.kind === "identity") return identity
  if (selection?.kind === "symmetric") return symmetric
  return undefined
}

function assertUsableIdentity(identity: PostQuantumIdentity): void {
  assertActiveProfile(identity.profile)
  assertActiveSuite(resolveSuite(identity.kem.algorithm, identity.signing.algorithm))
}

export function isUsableIdentity(identity: PostQuantumIdentity): boolean {
  try {
    assertUsableIdentity(identity)
    return true
  } catch {
    return false
  }
}

export function KeyDetailDialog({
  onOpenChange,
  ...rest
}: KeyDetailDialogProps) {
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const open =
    rest.selection !== null &&
    resolveKeyDetailRecord(rest.selection, rest.identity, rest.symmetric) !== undefined
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !fullscreenOpen) onOpenChange(false)
      }}
    >
      <KeyDetailContent
        {...rest}
        open={open}
        fullscreenOpen={fullscreenOpen}
        onFullscreenOpenChange={setFullscreenOpen}
      />
    </Dialog>
  )
}

export function KeyDetailContent({
  selection,
  identity,
  previous,
  symmetric,
  onChanged,
  open,
  fullscreenOpen,
  onFullscreenOpenChange,
}: KeyDetailContentProps) {
  const { language, t } = useI18n()
  const {
    preferences,
    loading: preferencesLoading,
    error: preferencesError,
    updatePreferences,
  } = usePreferences()
  const getPqClient = usePqCryptoClient()
  const { setSensitiveSession } = useSensitiveSession()
  const [view, setView] = useState<DetailView>({ kind: "detail" })
  // Seeded from the record because this can mount straight onto a selection (the
  // add modal switching to a freshly created key), where no change effect fires.
  const [renameDraft, setRenameDraft] = useState(
    () => resolveKeyDetailRecord(selection, identity, symmetric)?.name ?? "",
  )
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [pendingDestroy, setPendingDestroy] = useState<
    PostQuantumIdentity[] | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const [compatibilityUpdating, setCompatibilityUpdating] = useState(false)
  const [compatibilityError, setCompatibilityError] =
    useState<LocalizedMessage | null>(null)
  const [qrReady, setQrReady] = useState(false)
  const [qrHost, setQrHost] = useState<HTMLDivElement | null>(null)
  const qrGenerationRef = useRef(0)
  const presentedError = error ?? compatibilityError ?? preferencesError
  const localizedError = useLocalizedMessage(presentedError)
  const record = resolveKeyDetailRecord(selection, identity, symmetric)
  const setFullscreenOpen = onFullscreenOpenChange
  const sourceRef = useRef({
    selection: selection === null ? "" : `${selection.kind}:${selection.id}`,
    record,
  })
  const setQrHostRef = useCallback((node: HTMLDivElement | null) => {
    setQrHost(node)
  }, [])
  const submitRename = async () => {
    if (selection === null) return
    const parsed = keyNameSchema.safeParse(renameDraft)
    if (!parsed.success) {
      setError(
        messageKeyOrFallback(
          parsed.error.issues[0]?.message,
          "validation.name.required",
        ),
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (selection.kind === "identity") {
        await renameIdentity(selection.id, parsed.data)
      } else {
        await renameKeyRecord(selection.id, parsed.data)
      }
      await onChanged(selection)
      toast.success(t("keyDetail.rename.saved"))
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
    }
  }
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

  useEffect(() => {
    // A closed instance must stay silent: the keys page mounts this alongside the
    // add modal, and a patch from the idle one would clear the flags the open one
    // set. Closing is covered by the selection-change reset and the unmount cleanup.
    if (!open) return
    setSensitiveSession({
      cryptoBusy: busy,
      secretVisible: view.kind === "symmetric-qr",
    })
  }, [busy, open, setSensitiveSession, view.kind])
  useEffect(
    () => () => {
      qrGenerationRef.current += 1
      setSensitiveSession({ cryptoBusy: false, secretVisible: false })
    },
    [setSensitiveSession],
  )
  useEffect(() => {
    const source = selection === null ? "" : `${selection.kind}:${selection.id}`
    const changed =
      sourceRef.current.selection !== source || sourceRef.current.record !== record
    sourceRef.current = { selection: source, record }
    if (!changed) return
    qrGenerationRef.current += 1
    setFullscreenOpen(false)
    setQrReady(false)
    setView({ kind: "detail" })
    setPendingDelete(null)
    setPendingDestroy(null)
    setBusy(false)
    setError(null)
    setRenameDraft(record?.name ?? "")
    setSensitiveSession({ cryptoBusy: false, secretVisible: false })
    // Closing (selection -> null) and switching records both land here, so this
    // is also the reset the dismissed dialog relies on.
  }, [record, selection, setFullscreenOpen, setSensitiveSession])

  const leaveQrView = () => {
    qrGenerationRef.current += 1
    setFullscreenOpen(false)
    setQrReady(false)
    setView({ kind: "detail" })
    setError(null)
    setSensitiveSession({ secretVisible: false })
  }

  const showIdentityQr = async (
    target: PostQuantumIdentity,
    kind: "bundle" | "kem" | "signing",
  ) => {
    setQrReady(false)
    setBusy(true)
    setError(null)
    try {
      assertUsableIdentity(target)
      let artifactType: StorablePqArtifactKind
      let artifactBytes: Uint8Array
      if (kind === "bundle") {
        artifactType = "pq-public-identity"
        artifactBytes = encodePublicIdentityBundleV2(buildPublicBundle(target))
      } else if (kind === "kem") {
        artifactType = "pq-kem-public-key"
        artifactBytes = encodeKemPublicKeyEnvelopeV2({
          version: 2,
          type: "pq-kem-public-key",
          identityId: target.id,
          name: target.name,
          algorithm: target.kem.algorithm,
          keyId: target.kem.keyId,
          publicKey: target.kem.publicKey,
          createdAt: target.createdAt,
        })
      } else {
        artifactType = "pq-dsa-public-key"
        artifactBytes = encodeDsaPublicKeyEnvelopeV2({
          version: 2,
          type: "pq-dsa-public-key",
          identityId: target.id,
          name: target.name,
          algorithm: target.signing.algorithm,
          keyId: target.signing.keyId,
          publicKey: target.signing.publicKey,
          createdAt: target.createdAt,
        })
      }
      const minimumFrameBytes = minimumFrameBytesForArtifact(artifactBytes.byteLength)
      if (minimumFrameBytes > FRAME_BYTES_MAX) {
        throw new RangeError("artifact exceeds the maximum QR density")
      }
      qrGenerationRef.current += 1
      setView({
        kind: "identity-qr",
        qrKind: kind,
        targetName: target.name,
        generatedAt: Date.now(),
        artifactType,
        artifactBytes,
        generation: qrGenerationRef.current,
      })
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      setBusy(false)
    }
  }

  const showSymmetricQr = async (target: StoredKeyRecord) => {
    const generation = qrGenerationRef.current + 1
    qrGenerationRef.current = generation
    setQrReady(false)
    setBusy(true)
    setError(null)
    try {
      const envelope = await buildSymmetricKeyEnvelope(target)
      if (qrGenerationRef.current !== generation) return
      setView({
        kind: "symmetric-qr",
        payload: encodeEnvelopeToPayload(envelope),
        acknowledged: false,
      })
    } catch (caught) {
      setError(toAppError(caught, "KEY_TYPE_MISMATCH").code)
    } finally {
      setBusy(false)
    }
  }

  const rotate = async (target: PostQuantumIdentity) => {
    setBusy(true)
    setError(null)
    try {
      const rotated = await rotateIdentity({
        client: getPqClient(),
        vaultKey: await getOrCreateVaultKey(),
        current: target,
        now: Date.now(),
      })
      await saveRotation(rotated)
      await onChanged({ kind: "identity", id: rotated.next.id })
      toast.success(t("keyDetail.toast.rotated"))
    } catch (caught) {
      setError(toAppError(caught, "ENCRYPTION_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (target: PostQuantumIdentity) => {
    if (!selection) return
    setBusy(true)
    setError(null)
    try {
      await revokeIdentity(target.id, Date.now())
      await onChanged(selection)
      toast.success(t("keyDetail.toast.revoked"))
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!pendingDelete || !selection) return
    const target = pendingDelete
    setBusy(true)
    setError(null)
    try {
      if (target.kind === "symmetric") {
        await deleteKeyRecord(target.id)
        toast.success(t("keyDetail.toast.symmetricDeleted"))
      } else {
        await deleteIdentity(target.id)
        toast.success(t("keyDetail.toast.identityDeleted"))
      }
      setPendingDelete(null)
      setPendingDestroy(null)
      await onChanged(selection)
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const destroySuperseded = async () => {
    if (!pendingDestroy || !selection) return
    setBusy(true)
    setError(null)
    try {
      await deleteSupersededIdentities(
        pendingDestroy.map((generation) => generation.id),
      )
      setPendingDestroy(null)
      await onChanged(selection)
      toast.success(t("keyDetail.toast.supersededDestroyed"))
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const exportSymmetricQr = async () => {
    if (!symmetric || view.kind !== "symmetric-qr" || !view.acknowledged) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ecLevel = ecLevelFor("stored-key", preferences)
      const blob = await qrPngBlob(view.payload, {
        ecLevel,
        size: env.qrRenderSize,
      })
      triggerDownload(blob, buildExportFileName(symmetric.name, symmetric.id, "png"))
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      setBusy(false)
    }
  }

  const copySymmetricQr = async () => {
    if (view.kind !== "symmetric-qr" || !view.acknowledged) return
    try {
      await copyTextToClipboard(view.payload)
      toast.success(t("keyDetail.toast.copied"))
    } catch {
      setError("common.copyFailed")
    }
  }

  const identityQrTitle =
    view.kind === "identity-qr"
      ? t(`keyDetail.qr.${view.qrKind}Title`, { name: view.targetName })
      : null
  const symmetricFullscreenControls = (
    <div
      data-fullscreen-controls
      className="mx-auto flex w-full max-w-2xl flex-col items-stretch gap-3"
    >
      <div className="flex items-start gap-2 rounded-md border border-destructive/60 p-3 text-sm text-destructive">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span className="font-medium">{t("keyDetail.symmetricQr.secretTitle")}</span>
      </div>
    </div>
  )

  return (
    <>
      <NoAutofocusDialogContent
        className="grid max-h-[95dvh] max-w-lg grid-rows-[minmax(0,1fr)] overflow-hidden"
        aria-busy={busy}
        aria-hidden={fullscreenOpen || undefined}
        inert={fullscreenOpen || undefined}
      >
          <div className="grid min-h-0 gap-4 overflow-y-auto pb-14">
            <DialogHeader>
              <DialogTitle>
                {view.kind === "identity-qr"
                  ? identityQrTitle
                  : view.kind === "symmetric-qr"
                    ? t("keyDetail.symmetricQr.title")
                    : record?.name}
              </DialogTitle>
              {view.kind === "identity-qr" && (
                <DialogDescription>{t("keyDetail.identityQr.desc")}</DialogDescription>
              )}
              {view.kind === "symmetric-qr" && (
                <DialogDescription>{t("keyDetail.symmetricQr.desc")}</DialogDescription>
              )}
            </DialogHeader>

            {presentedError && (
              <Alert variant="destructive" role="alert">
                <AlertTitle>{t("common.operationFailed")}</AlertTitle>
                <AlertDescription>{localizedError}</AlertDescription>
              </Alert>
            )}

            {view.kind !== "detail" && (
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-fit"
                  disabled={busy}
                  onClick={leaveQrView}
                >
                  <ArrowLeft aria-hidden="true" />
                  {t("keyDetail.backToDetail")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={t("qrDisplay.fullscreen.button")}
                  disabled={!qrReady}
                  onClick={() => setFullscreenOpen(true)}
                >
                  <Expand aria-hidden="true" />
                </Button>
              </div>
            )}

            {view.kind === "detail" && record && (
              <div className="space-y-2">
                <Label htmlFor="key-rename">{t("keyDetail.rename.label")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="key-rename"
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    maxLength={80}
                    className="h-11"
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0"
                    disabled={busy || renameDraft.trim().length === 0}
                    onClick={() => void submitRename()}
                  >
                    {t("keyDetail.rename.submit")}
                  </Button>
                </div>
              </div>
            )}

            {view.kind === "detail" && identity && (
              <IdentityDetails
                identity={identity}
                previous={previous ?? []}
                busy={busy}
                onShow={showIdentityQr}
                onRotate={rotate}
                onRevoke={revoke}
                onDestroySuperseded={(generations) =>
                  setPendingDestroy(generations)
                }
                onDelete={(target) =>
                  setPendingDelete({
                    kind: "identity",
                    id: target.id,
                    name: target.name,
                  })
                }
              />
            )}

            {view.kind === "detail" && symmetric && (
              <SymmetricDetails
                record={symmetric}
                busy={busy}
                onShow={() => void showSymmetricQr(symmetric)}
                onDelete={() =>
                  setPendingDelete({
                    kind: "symmetric",
                    id: symmetric.id,
                    name: symmetric.name,
                  })
                }
              />
            )}

            {view.kind === "identity-qr" && <div ref={setQrHostRef} />}

            {view.kind === "symmetric-qr" && symmetric && (
              <div className="space-y-4">
                <div ref={setQrHostRef} />
                <Alert variant="destructive">
                  <AlertTitle>{t("keyDetail.symmetricQr.secretTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("keyDetail.symmetricQr.secretBody")}
                  </AlertDescription>
                </Alert>
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="secret-ack"
                    checked={view.acknowledged}
                    onCheckedChange={(checked) =>
                      setView({ ...view, acknowledged: checked === true })
                    }
                  />
                  <Label htmlFor="secret-ack">{t("common.riskUnderstood")}</Label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={!view.acknowledged || busy}
                    onClick={() => void exportSymmetricQr()}
                  >
                    <Download aria-hidden="true" />
                    {t("common.download")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={!view.acknowledged || busy}
                    onClick={() => void copySymmetricQr()}
                  >
                    <Clipboard aria-hidden="true" />
                    {t("common.copy")}
                  </Button>
                </div>
              </div>
            )}
          </div>
      </NoAutofocusDialogContent>

      {qrHost &&
        view.kind === "identity-qr" &&
        createPortal(
          <IdentityQrSession
            key={view.generation}
            view={view}
            title={identityQrTitle ?? ""}
            enabled={open}
            fullscreenOpen={fullscreenOpen}
            showFullscreenTrigger={false}
            preferences={preferences}
            compatibilityDisabled={
              preferencesLoading ||
              preferencesError !== null ||
              compatibilityUpdating
            }
            onCompatibilityModeChange={changeCompatibilityMode}
            onFirstRendered={() => setQrReady(true)}
            onFullscreenOpenChange={setFullscreenOpen}
          />,
          qrHost,
        )}

      {qrHost &&
        view.kind === "symmetric-qr" &&
        createPortal(
          <QrDisplay
            payload={view.payload}
            ecLevel={ecLevelFor("stored-key", preferences)}
            size={env.qrRenderSize}
            title={t("keyDetail.symmetricQr.title")}
            fullscreenControls={{
              kind: "arbitrary",
              content: symmetricFullscreenControls,
            }}
            fullscreenOpen={fullscreenOpen}
            showFullscreenTrigger={false}
            onRendered={() => setQrReady(true)}
            onFullscreenOpenChange={setFullscreenOpen}
          />,
          qrHost,
        )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingDelete(null)
            setPendingDestroy(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete
                ? t("keyDetail.delete.titleNamed", { name: pendingDelete.name })
                : t("keyDetail.delete.titleGeneric")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "identity"
                ? t("keyDetail.delete.body.identity")
                : t("keyDetail.delete.body.symmetric")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              {t("keyDetail.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDestroy !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDestroy(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("keyDetail.destroy.title", {
                count: pendingDestroy?.length ?? 0,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("keyDetail.destroy.body", {
                dates: (pendingDestroy ?? [])
                  .map((generation) =>
                    formatDateTime(generation.createdAt, language),
                  )
                  .join(", "),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void destroySuperseded()}
            >
              {t("keyDetail.destroy.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function IdentityQrSession({
  view,
  title,
  enabled,
  fullscreenOpen,
  showFullscreenTrigger,
  preferences,
  compatibilityDisabled,
  onCompatibilityModeChange,
  onFirstRendered,
  onFullscreenOpenChange,
}: {
  view: IdentityQrView
  title: string
  enabled: boolean
  fullscreenOpen: boolean
  showFullscreenTrigger: boolean
  preferences: Pick<Preferences, "frameBytes" | "frameIntervalMs">
  compatibilityDisabled: boolean
  onCompatibilityModeChange: (enabled: boolean) => void | Promise<void>
  onFirstRendered: () => void
  onFullscreenOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const selectedFramePair = selectedGeneratedDisplayPair(preferences)
  const compatibilityEnabled =
    selectedFramePair === COMPATIBLE_GENERATED_DISPLAY_PAIR
  const effectiveFrameBytes = Math.max(
    selectedFramePair.frameBytes,
    minimumFrameBytesForArtifact(view.artifactBytes.byteLength),
  )
  const densityRaised =
    compatibilityEnabled &&
    effectiveFrameBytes > COMPATIBLE_GENERATED_DISPLAY_PAIR.frameBytes
  const split = useFrameSplit({
    bytes: view.artifactBytes,
    artifactType: view.artifactType,
    frameBytes: effectiveFrameBytes,
    enabled,
    generation: `${view.generation}:${effectiveFrameBytes}`,
  })
  const localizedError = useLocalizedMessage(split.error)

  return (
    <>
      {split.error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("qrDisplay.error.title")}</AlertTitle>
          <AlertDescription>{localizedError}</AlertDescription>
        </Alert>
      )}
      {split.frames.length === 0 && split.splitting && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {t("qrDisplay.generating")}
        </p>
      )}
      {(split.frames.length > 0 || split.splitting) && (
        <AnimatedQrFrames
          frames={split.frames}
          frameIntervalMs={selectedFramePair.frameIntervalMs}
          densityRaised={densityRaised}
          compatibilityControl={{
            enabled: compatibilityEnabled,
            disabled: compatibilityDisabled,
            onEnabledChange: onCompatibilityModeChange,
          }}
          outputName={t("keyDetail.qr.outputName", {
            title,
            date: formatSuggestedDate(view.generatedAt),
          })}
          title={title}
          splitting={split.splitting}
          fullscreenOpen={fullscreenOpen}
          showFullscreenTrigger={showFullscreenTrigger}
          onFirstRendered={onFirstRendered}
          onFullscreenOpenChange={onFullscreenOpenChange}
        />
      )}
    </>
  )
}

function IdentityDetails({
  identity,
  previous,
  busy,
  onShow,
  onRotate,
  onRevoke,
  onDestroySuperseded,
  onDelete,
}: {
  identity: PostQuantumIdentity
  previous: PostQuantumIdentity[]
  busy: boolean
  onShow: (
    identity: PostQuantumIdentity,
    kind: "bundle" | "kem" | "signing",
  ) => Promise<void>
  onRotate: (identity: PostQuantumIdentity) => Promise<void>
  onRevoke: (identity: PostQuantumIdentity) => Promise<void>
  onDestroySuperseded: (generations: PostQuantumIdentity[]) => void
  onDelete: (identity: PostQuantumIdentity) => void
}) {
  const { language, t } = useI18n()
  const supported = isUsableIdentity(identity)
  const old = identity.status !== "active"
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-xs text-muted-foreground">{identity.id}</p>
        <Badge variant={old || !supported ? "secondary" : "default"}>
          {supported
            ? t(`keyStatus.${identity.status}`)
            : t("keyDetail.badge.legacyProfile")}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {!supported
          ? t("keyDetail.identity.legacyNote")
          : old
            ? t("keyDetail.identity.oldNote")
            : t("keyDetail.identity.activeNote")}
      </p>
      <Fingerprint
        label={t("common.identityFingerprint")}
        value={identity.identityFingerprint}
      />
      <Fingerprint
        label={t("keyDetail.identity.kemFingerprintLabel", {
          algorithm: identity.kem.algorithm,
        })}
        value={identity.kem.fingerprint}
      />
      <Fingerprint
        label={t("keyDetail.identity.signingFingerprintLabel", {
          algorithm: identity.signing.algorithm,
        })}
        value={identity.signing.fingerprint}
      />
      <p className="text-xs text-muted-foreground">
        {t("common.created", {
          datetime: formatDateTime(identity.createdAt, language),
        })}
      </p>
      <div className="grid grid-cols-1 gap-2">
        {supported && !old && (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => void onShow(identity, "bundle")}
            >
              <QrCode aria-hidden="true" />
              {t("keyDetail.button.bundleQr")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => void onShow(identity, "kem")}
            >
              <QrCode aria-hidden="true" />
              {t("keyDetail.button.kemQr")}
            </Button>
          </>
        )}
        {supported && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => void onShow(identity, "signing")}
          >
            <QrCode aria-hidden="true" />
            {t("keyDetail.button.signingQr")}
          </Button>
        )}
        {supported && identity.status === "active" && (
          <>
            <Button
              type="button"
              variant="secondary"
              className="h-11"
              disabled={busy}
              onClick={() => void onRotate(identity)}
            >
              <RefreshCw aria-hidden="true" />
              {t("keyDetail.button.rotate")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              disabled={busy}
              onClick={() => void onRevoke(identity)}
            >
              <Trash2 aria-hidden="true" />
              {t("keyDetail.button.revoke")}
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="destructive"
          className="h-11"
          disabled={busy}
          aria-label={t("common.deleteAriaLabel", { name: identity.name })}
          onClick={() => onDelete(identity)}
        >
          <Trash2 aria-hidden="true" />
          {t("common.delete")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("keyDetail.revokeNote")}</p>
      {previous.length > 0 && (
        <Button
          type="button"
          variant="destructive"
          className="h-11 w-full"
          disabled={busy}
          onClick={() => onDestroySuperseded(previous)}
        >
          <Trash2 aria-hidden="true" />
          {t("keyDetail.previous.destroyAll", { count: previous.length })}
        </Button>
      )}
      {previous.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="group h-9 w-full justify-between px-2 text-xs text-muted-foreground"
            >
              {t("keyDetail.previous.toggle", { count: previous.length })}
              <ChevronDown
                aria-hidden="true"
                className="size-4 transition-transform group-data-[state=open]:rotate-180"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {previous.map((generation) => {
              const generationSupported = isUsableIdentity(generation)
              return (
                <div key={generation.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {t("common.created", {
                        datetime: formatDateTime(generation.createdAt, language),
                      })}
                    </p>
                    <Badge variant="secondary">
                      {generationSupported
                        ? t(`keyStatus.${generation.status}`)
                        : t("keyDetail.badge.legacyProfile")}
                    </Badge>
                  </div>
                  <p className="font-mono text-sm">
                    {t("common.fingerprintCompare", {
                      value: formatFingerprint(generation.identityFingerprint),
                    })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {generationSupported && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void onShow(generation, "signing")}
                      >
                        <QrCode aria-hidden="true" />
                        {t("keyDetail.button.signingQr")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      aria-label={t("common.deleteAriaLabel", {
                        name: generation.name,
                      })}
                      onClick={() => onDelete(generation)}
                    >
                      <Trash2 aria-hidden="true" />
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>
              )
            })}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function SymmetricDetails({
  record,
  busy,
  onShow,
  onDelete,
}: {
  record: StoredKeyRecord
  busy: boolean
  onShow: () => void
  onDelete: () => void
}) {
  const { language, t } = useI18n()
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="break-all font-mono text-xs text-muted-foreground">{record.id}</p>
        <Badge>AES-256-GCM</Badge>
      </div>
      <Fingerprint
        label={t("keyDetail.symmetric.fingerprintLabel")}
        value={record.fingerprint}
      />
      <p className="text-xs text-muted-foreground">
        {t("common.created", {
          datetime: formatDateTime(record.createdAt, language),
        })}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={busy}
          onClick={onShow}
        >
          <QrCode aria-hidden="true" />
          {t("keyDetail.button.showSecretQr")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="h-11"
          disabled={busy}
          aria-label={t("common.deleteAriaLabel", { name: record.name })}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
          {t("common.delete")}
        </Button>
      </div>
    </div>
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
