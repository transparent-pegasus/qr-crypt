import { useEffect, useState } from "react"
import {
  ArrowLeft,
  ChevronDown,
  Clipboard,
  Download,
  FileCode2,
  QrCode,
  RefreshCw,
  Trash2,
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
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePreferences } from "@/hooks/use-preferences"
import {
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"
import { PQ_KEY_QR_FRAME_BYTES, pqIdentityQrFrameCount } from "@/lib/limits"
import { ecLevelFor } from "@/qr/encode"
import {
  buildExportFileName,
  copyTextToClipboard,
  qrPngBlob,
  qrSvgBlob,
  triggerDownload,
} from "@/qr/export-image"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeEnvelopeToPayload } from "@/qr/payload"
import type {
  PostQuantumIdentity,
  QrFrameV2,
  StoredKeyRecord,
  StorablePqArtifactKind,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { deleteKeyRecord } from "@/storage/key-repository"
import {
  deleteIdentity,
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
  frames: QrFrameV2[]
}

interface SymmetricQrView {
  kind: "symmetric-qr"
  payload: string
  acknowledged: boolean
}

type DetailView = { kind: "detail" } | IdentityQrView | SymmetricQrView

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
  selection,
  identity,
  previous,
  symmetric,
  onOpenChange,
  onChanged,
}: KeyDetailDialogProps) {
  const { t } = useI18n()
  const { preferences } = usePreferences()
  const getPqClient = usePqCryptoClient()
  const { setSensitiveSession } = useSensitiveSession()
  const [view, setView] = useState<DetailView>({ kind: "detail" })
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LocalizedMessage | null>(null)
  const localizedError = useLocalizedMessage(error)
  const record =
    selection?.kind === "identity"
      ? identity
      : selection?.kind === "symmetric"
        ? symmetric
        : undefined
  const open = selection !== null && record !== undefined

  useEffect(() => {
    setSensitiveSession({
      cryptoBusy: busy,
      secretVisible: open && view.kind === "symmetric-qr",
    })
  }, [busy, open, setSensitiveSession, view.kind])
  useEffect(
    () => () => {
      setSensitiveSession({ cryptoBusy: false, secretVisible: false })
    },
    [setSensitiveSession],
  )

  const close = () => {
    setView({ kind: "detail" })
    setPendingDelete(null)
    setBusy(false)
    setError(null)
    setSensitiveSession({ cryptoBusy: false, secretVisible: false })
    onOpenChange(false)
  }

  const showIdentityQr = async (
    target: PostQuantumIdentity,
    kind: "bundle" | "kem" | "signing",
  ) => {
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
      setView({
        kind: "identity-qr",
        qrKind: kind,
        targetName: target.name,
        generatedAt: Date.now(),
        frames:
          artifactType === "pq-public-identity"
            ? await splitIntoFrames({
                artifactType,
                artifactBytes,
                frameCount: pqIdentityQrFrameCount(artifactBytes.byteLength),
              })
            : await splitIntoFrames({
                artifactType,
                artifactBytes,
                frameBytes: PQ_KEY_QR_FRAME_BYTES,
              }),
      })
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").code)
    } finally {
      setBusy(false)
    }
  }

  const showSymmetricQr = async (target: StoredKeyRecord) => {
    setBusy(true)
    setError(null)
    try {
      const envelope = await buildSymmetricKeyEnvelope(target)
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
      await onChanged(selection)
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBusy(false)
    }
  }

  const exportSymmetricQr = async (format: "png" | "svg") => {
    if (!symmetric || view.kind !== "symmetric-qr" || !view.acknowledged) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ecLevel = ecLevelFor("stored-key", preferences)
      const blob =
        format === "png"
          ? await qrPngBlob(view.payload, { ecLevel, size: env.qrRenderSize })
          : await qrSvgBlob(view.payload, { ecLevel })
      triggerDownload(blob, buildExportFileName(symmetric.name, symmetric.id, format))
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

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
        <NoAutofocusDialogContent
          className="max-h-[95dvh] max-w-lg overflow-y-auto"
          aria-busy={busy}
        >
          <DialogHeader>
            <DialogTitle>
              {view.kind === "identity-qr"
                ? identityQrTitle
                : view.kind === "symmetric-qr"
                  ? t("keyDetail.symmetricQr.title")
                  : record?.name}
            </DialogTitle>
            {view.kind === "identity-qr" && (
              <DialogDescription>
                {t("keyDetail.identityQr.desc")}
              </DialogDescription>
            )}
            {view.kind === "symmetric-qr" && (
              <DialogDescription>
                {t("keyDetail.symmetricQr.desc")}
              </DialogDescription>
            )}
          </DialogHeader>

          {error && (
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
              onClick={() => {
                setView({ kind: "detail" })
                setError(null)
              }}
            >
              <ArrowLeft aria-hidden="true" />
              {t("keyDetail.backToDetail")}
            </Button>
          )}

          {view.kind === "detail" && identity && (
            <IdentityDetails
              identity={identity}
              previous={previous ?? []}
              busy={busy}
              onShow={showIdentityQr}
              onRotate={rotate}
              onRevoke={revoke}
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

          {view.kind === "identity-qr" && (
            <AnimatedQrFrames
              frames={view.frames}
              frameIntervalMs={preferences.frameIntervalMs}
              outputName={t("keyDetail.qr.outputName", {
                title: identityQrTitle ?? "",
                date: formatSuggestedDate(view.generatedAt),
              })}
              title={identityQrTitle ?? ""}
              fullscreenEnabled={false}
            />
          )}

          {view.kind === "symmetric-qr" && symmetric && (
            <div className="space-y-4">
              <QrDisplay
                payload={view.payload}
                ecLevel={ecLevelFor("stored-key", preferences)}
                size={env.qrRenderSize}
                title={t("keyDetail.symmetricQr.title")}
                fullscreenEnabled={false}
              />
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={!view.acknowledged || busy}
                  onClick={() => void exportSymmetricQr("png")}
                >
                  <Download aria-hidden="true" />
                  PNG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={!view.acknowledged || busy}
                  onClick={() => void exportSymmetricQr("svg")}
                >
                  <FileCode2 aria-hidden="true" />
                  SVG
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
        </NoAutofocusDialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDelete(null)
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
      <p className="text-xs text-muted-foreground">
        {t("keyDetail.revokeNote")}
      </p>
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
                        ? generation.status
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
