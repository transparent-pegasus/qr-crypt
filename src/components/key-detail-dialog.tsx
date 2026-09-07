import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { DeleteConfirm } from "@/components/key-detail/delete-confirm"
import { DestroySupersededConfirm } from "@/components/key-detail/destroy-superseded-confirm"
import { IdentityDetails } from "@/components/key-detail/identity-details"
import { IdentityQrSession } from "@/components/key-detail/identity-qr-session"
import { RenameField } from "@/components/key-detail/rename-field"
import { SymmetricDetails } from "@/components/key-detail/symmetric-details"
import { SymmetricQrView } from "@/components/key-detail/symmetric-qr-view"
import type { DetailView, PendingDelete } from "@/components/key-detail/types"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { QrDisplay } from "@/components/qr-display"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AppError, toAppError } from "@/crypto/errors"
import {
  buildSymmetricKeyEnvelopeV2,
  rotateSymmetricKeyRecord,
} from "@/crypto/key-generation"
import {
  encodePublicIdentityBundleV2,
  encodeSymmetricKeyEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import { buildPublicBundle, rotateIdentity } from "@/crypto/pq/identity"
import { zeroize } from "@/crypto/pq/zeroize"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { useCompatibilityMode } from "@/hooks/use-compatibility-mode"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePreferences } from "@/hooks/use-preferences"
import {
  messageKeyOrFallback,
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"
import { copyTextToClipboard } from "@/lib/clipboard"
import {
  FRAME_BYTES_MAX,
  minimumFrameBytesForArtifact,
  singleFrameBytesFor,
} from "@/lib/limits"
import {
  buildExportFileName,
  qrPngBlob,
  triggerDownload,
} from "@/qr/export-image"
import { splitIntoFrames } from "@/qr/multipart/split"
import { buildV2Payload, encodeFrameToPayload } from "@/qr/wire-codec"
import {
  type PostQuantumIdentity,
  type StoredKeyRecord,
  type StorableArtifactKind,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { keyNameSchema } from "@/schemas/key-schema"
import {
  deleteKeyRecord,
  getActiveKeyRecord,
  renameKeyRecord,
  saveSymmetricRotation,
} from "@/storage/key-repository"
import {
  deleteIdentity,
  deleteSupersededIdentities,
  renameIdentity,
  revokeIdentity,
  saveRotation,
} from "@/storage/pq-identity-repository"

export type KeySelection =
  { kind: "identity"; id: string } | { kind: "symmetric"; id: string }

interface KeyDetailDialogProps {
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

function resolveKeyDetailRecord(
  selection: KeySelection | null,
  identity: PostQuantumIdentity | undefined,
  symmetric: StoredKeyRecord | undefined,
): PostQuantumIdentity | StoredKeyRecord | undefined {
  if (selection?.kind === "identity") return identity
  if (selection?.kind === "symmetric") return symmetric
  return undefined
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
  const { t } = useI18n()
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
  } = useCompatibilityMode({ updatePreferences, active: open })
  const getPqClient = usePqCryptoClient()
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
  const [qrHost, setQrHost] = useState<HTMLDivElement | null>(null)
  const qrGenerationRef = useRef(0)
  const symmetricArtifactRef = useRef<Uint8Array | null>(null)
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
  const clearSymmetricArtifact = useCallback(() => {
    zeroize(symmetricArtifactRef.current ?? undefined)
    symmetricArtifactRef.current = null
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
  useEffect(
    () => () => {
      qrGenerationRef.current += 1
      clearSymmetricArtifact()
    },
    [clearSymmetricArtifact],
  )
  useEffect(() => {
    const source = selection === null ? "" : `${selection.kind}:${selection.id}`
    const changed =
      sourceRef.current.selection !== source || sourceRef.current.record !== record
    sourceRef.current = { selection: source, record }
    if (!changed) return
    qrGenerationRef.current += 1
    clearSymmetricArtifact()
    setFullscreenOpen(false)
    setView({ kind: "detail" })
    setPendingDelete(null)
    setPendingDestroy(null)
    setBusy(false)
    resetCompatibilityMode()
    setError(null)
    setRenameDraft(record?.name ?? "")
    // Closing (selection -> null) and switching records both land here, so this
    // is also the reset the dismissed dialog relies on.
  }, [
    record,
    clearSymmetricArtifact,
    resetCompatibilityMode,
    selection,
    setFullscreenOpen,
  ])

  const leaveQrView = () => {
    qrGenerationRef.current += 1
    clearSymmetricArtifact()
    setFullscreenOpen(false)
    setView({ kind: "detail" })
    setError(null)
  }

  const showIdentityQr = async (target: PostQuantumIdentity) => {
    setBusy(true)
    setError(null)
    try {
      const artifactType: StorableArtifactKind = "pq-public-identity"
      const artifactBytes = encodePublicIdentityBundleV2(buildPublicBundle(target))
      const minimumFrameBytes = minimumFrameBytesForArtifact(artifactBytes.byteLength)
      if (minimumFrameBytes > FRAME_BYTES_MAX) {
        throw new RangeError("artifact exceeds the maximum QR density")
      }
      qrGenerationRef.current += 1
      setView({
        kind: "identity-qr",
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
    let artifactBytes: Uint8Array | undefined
    setBusy(true)
    setError(null)
    try {
      const envelope = await buildSymmetricKeyEnvelopeV2(target)
      try {
        artifactBytes = encodeSymmetricKeyEnvelopeV2(envelope)
      } finally {
        zeroize(envelope.key)
      }
      const frames = await splitIntoFrames({
        artifactType: "symmetric-key",
        artifactBytes,
        frameBytes: singleFrameBytesFor(artifactBytes.byteLength),
      })
      if (frames.length !== 1 || frames[0] === undefined) {
        for (const frame of frames) zeroize(frame.chunk)
        throw new AppError("QR_TOO_LARGE")
      }
      let framePayload: string
      try {
        framePayload = encodeFrameToPayload(frames[0])
      } finally {
        zeroize(frames[0].chunk)
      }
      if (qrGenerationRef.current !== generation) return
      clearSymmetricArtifact()
      symmetricArtifactRef.current = artifactBytes
      setView({ kind: "symmetric-qr", payload: framePayload })
      artifactBytes = undefined
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      zeroize(artifactBytes)
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

  const rotateSymmetric = async (target: StoredKeyRecord) => {
    setBusy(true)
    setError(null)
    try {
      const current = await getActiveKeyRecord(target.id)
      if (current === undefined) throw new AppError("STORAGE_FAILED")
      const rotated = await rotateSymmetricKeyRecord(current, Date.now())
      await saveSymmetricRotation(rotated)
      await onChanged({ kind: "symmetric", id: rotated.next.id })
      toast.success(t("keyDetail.toast.symmetricRotated"))
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
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
    if (!symmetric || view.kind !== "symmetric-qr") return
    setBusy(true)
    setError(null)
    try {
      const blob = await qrPngBlob(view.payload, {
        ecLevel: "Q",
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
    const artifactBytes = symmetricArtifactRef.current
    if (view.kind !== "symmetric-qr" || artifactBytes === null) return
    try {
      await copyTextToClipboard(buildV2Payload("symmetric-key", artifactBytes))
      toast.success(t("keyDetail.toast.copied"))
    } catch {
      setError("common.copyFailed")
    }
  }

  const identityQrTitle =
    view.kind === "identity-qr"
      ? t("keyDetail.identityQr.title", { name: view.targetName })
      : null

  return (
    <>
      <NoAutofocusDialogContent
        className="grid max-h-[95dvh] max-w-lg grid-rows-[minmax(0,1fr)] overflow-hidden p-0 py-6"
        aria-busy={busy}
        aria-hidden={fullscreenOpen || undefined}
        inert={fullscreenOpen || undefined}
      >
        <div className="min-h-0 overflow-y-auto">
          <div className="grid gap-4 px-6 pb-14">
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
            )}

            {view.kind === "detail" && record && (
              <RenameField
                value={renameDraft}
                busy={busy}
                onChange={setRenameDraft}
                onSubmit={submitRename}
              />
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
                onRotate={() => void rotateSymmetric(symmetric)}
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
              <SymmetricQrView
                busy={busy}
                onCopy={copySymmetricQr}
                onExport={exportSymmetricQr}
              >
                <div ref={setQrHostRef} />
              </SymmetricQrView>
            )}
          </div>
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
            preferences={preferences}
            compatibilityDisabled={
              preferencesLoading ||
              preferencesError !== null ||
              compatibilityUpdating
            }
            onCompatibilityModeChange={changeCompatibilityMode}
            onFullscreenOpenChange={setFullscreenOpen}
          />,
          qrHost,
        )}

      {qrHost &&
        view.kind === "symmetric-qr" &&
        createPortal(
          <QrDisplay
            payload={view.payload}
            ecLevel="Q"
            size={env.qrRenderSize}
            title={t("keyDetail.symmetricQr.title")}
            fullscreenOpen={fullscreenOpen}
            onFullscreenOpenChange={setFullscreenOpen}
          />,
          qrHost,
        )}

      <DeleteConfirm
        open={pendingDelete !== null}
        target={pendingDelete}
        busy={busy}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPendingDelete(null)
            setPendingDestroy(null)
          }
        }}
        onConfirm={remove}
      />

      <DestroySupersededConfirm
        open={pendingDestroy !== null}
        generations={pendingDestroy}
        busy={busy}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDestroy(null)
        }}
        onConfirm={destroySuperseded}
      />
    </>
  )
}
