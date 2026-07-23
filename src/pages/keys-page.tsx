import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Download,
  FileCode2,
  KeyRound,
  LoaderCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { useFeatureSupport, useSensitiveSession } from "@/app/providers"
import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import { MultipartScanPanel } from "@/components/multipart-scan-panel"
import { QrDisplay } from "@/components/qr-display"
import { QrScannerDialog } from "@/components/qr-scanner-dialog"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { AppError, toAppError } from "@/crypto/errors"
import {
  buildSymmetricKeyEnvelope,
  createSymmetricKeyRecord,
  importSymmetricKeyRecord,
} from "@/crypto/key-generation"
import {
  decodeDsaPublicKeyEnvelopeV2,
  decodeKemPublicKeyEnvelopeV2,
  decodePublicIdentityBundleV2,
  encodeDsaPublicKeyEnvelopeV2,
  encodeKemPublicKeyEnvelopeV2,
  encodePublicIdentityBundleV2,
} from "@/crypto/pq/canonical-cbor"
import { buildPublicBundle, createIdentity, rotateIdentity } from "@/crypto/pq/identity"
import { PQ_PROFILES } from "@/crypto/pq/profiles"
import {
  ACTIVE_PROFILE,
  assertActiveProfile,
  assertActiveSuite,
  resolveSuite,
} from "@/crypto/pq/suites"
import { pqIdentityFingerprint, pqKeyFingerprint } from "@/crypto/pq/wire-bytes"
import { getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { generateArtifactId, generateKeyId } from "@/crypto/random"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import {
  formatDateTime,
  formatFingerprint,
  formatSuggestedDate,
} from "@/features/presentation"
import { useKeys } from "@/hooks/use-keys"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePqRecords } from "@/hooks/use-pq-records"
import { usePreferences } from "@/hooks/use-preferences"
import { ecLevelFor } from "@/qr/encode"
import {
  buildExportFileName,
  copyTextToClipboard,
  qrPngBlob,
  qrSvgBlob,
  triggerDownload,
} from "@/qr/export-image"
import { splitIntoFrames } from "@/qr/multipart/split"
import { decodePayload, encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"
import type {
  DsaPublicKeyEnvelopeV2,
  KemPublicKeyEnvelopeV2,
  PostQuantumIdentity,
  PqPublicBundleRecord,
  PublicIdentityBundleV2,
  QrFrameV2,
  StoredKeyRecord,
  StoredQrArtifact,
} from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { keyNameSchema, qrNameSchema } from "@/schemas/key-schema"
import { deleteKeyRecord, saveKeyRecord } from "@/storage/key-repository"
import {
  confirmBundleFingerprint,
  deleteBundle,
  revokeBundle,
  saveBundle,
} from "@/storage/pq-bundle-repository"
import {
  deleteIdentity,
  revokeIdentity,
  saveIdentity,
  saveRotation,
} from "@/storage/pq-identity-repository"
import { saveQrArtifact } from "@/storage/qr-repository"

type KeysTab = "symmetric" | "identity" | "bundle" | "scan"

interface FramedQrSession {
  title: string
  outputName: string
  frames: QrFrameV2[]
}

interface SymmetricQrSession {
  record: StoredKeyRecord
  payload: string
  name: string
  acknowledged: boolean
}

type SingleKeyRead = KemPublicKeyEnvelopeV2 | DsaPublicKeyEnvelopeV2

function assertUsableIdentity(identity: PostQuantumIdentity): void {
  assertActiveProfile(identity.profile)
  assertActiveSuite(resolveSuite(identity.kem.algorithm, identity.signing.algorithm))
}

function isUsableIdentity(identity: PostQuantumIdentity): boolean {
  try {
    assertUsableIdentity(identity)
    return true
  } catch {
    return false
  }
}

function assertUsableBundle(bundle: PublicIdentityBundleV2 | PqPublicBundleRecord): void {
  assertActiveSuite(resolveSuite(bundle.kem.algorithm, bundle.signing.algorithm))
}

function isUsableBundle(bundle: PqPublicBundleRecord): boolean {
  try {
    assertUsableBundle(bundle)
    return true
  } catch {
    return false
  }
}

function assertUsableSingleKey(envelope: SingleKeyRead): void {
  const suite =
    envelope.type === "pq-kem-public-key"
      ? resolveSuite(envelope.algorithm)
      : resolveSuite(PQ_PROFILES[ACTIVE_PROFILE].kem.algorithm, envelope.algorithm)
  assertActiveSuite(suite)
}

export function KeysPage() {
  const { camera } = useFeatureSupport()
  const { setSensitiveSession, resetSensitiveSession } = useSensitiveSession()
  const { preferences } = usePreferences()
  const { keys, loading: keysLoading, error: keysError, refresh: refreshKeys } = useKeys()
  const {
    identities,
    bundles,
    loading: pqLoading,
    error: pqError,
    refresh: refreshPq,
  } = usePqRecords()
  const getPqClient = usePqCryptoClient()
  const [tab, setTab] = useState<KeysTab>("symmetric")
  const [keyName, setKeyName] = useState("")
  const [importPayload, setImportPayload] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [framedQr, setFramedQr] = useState<FramedQrSession | null>(null)
  const [symmetricQr, setSymmetricQr] = useState<SymmetricQrSession | null>(null)
  const [duplicateArtifact, setDuplicateArtifact] = useState<StoredQrArtifact | null>(
    null,
  )
  const [pendingBundle, setPendingBundle] = useState<PqPublicBundleRecord | null>(null)
  const [fingerprintChecked, setFingerprintChecked] = useState(false)
  const [singleKeyRead, setSingleKeyRead] = useState<SingleKeyRead | null>(null)
  const [singleKeyFingerprint, setSingleKeyFingerprint] = useState("")
  const [scannerOpen, setScannerOpen] = useState(false)
  const [pendingSymmetricImport, setPendingSymmetricImport] =
    useState<StoredKeyRecord | null>(null)
  const [symmetricImportName, setSymmetricImportName] = useState("")
  const [symmetricImportAcknowledged, setSymmetricImportAcknowledged] = useState(false)

  const symmetricKeys = useMemo(
    () => keys.filter((key) => key.kind === "symmetric"),
    [keys],
  )
  const legacyKeys = useMemo(
    () => keys.filter((key) => key.kind === "rsa-key-pair" || key.kind === "public-key"),
    [keys],
  )
  const scanSession = useMemo(
    () => new MultipartScanSession(preferences.transferTimeoutMinutes),
    [preferences.transferTimeoutMinutes],
  )
  // 最新世代のみをカード表示し、rotatedFromId を遡った旧世代は配下に畳む
  const identityGroups = useMemo(() => {
    const byId = new Map(identities.map((identity) => [identity.id, identity]))
    const superseded = new Set(
      identities
        .map((identity) => identity.rotatedFromId)
        .filter((id): id is string => id !== undefined),
    )
    return identities
      .filter((identity) => !superseded.has(identity.id))
      .map((head) => {
        const previous: PostQuantumIdentity[] = []
        const visited = new Set([head.id])
        for (let cursor = head.rotatedFromId; cursor !== undefined;) {
          const generation = byId.get(cursor)
          if (generation === undefined || visited.has(generation.id)) break
          visited.add(generation.id)
          previous.push(generation)
          cursor = generation.rotatedFromId
        }
        return { head, previous }
      })
  }, [identities])

  useEffect(() => {
    setSensitiveSession({
      hasPlaintext: false,
      hasDecrypted: false,
      cryptoBusy: busy,
      secretVisible: symmetricQr !== null || pendingSymmetricImport !== null,
    })
  }, [busy, pendingSymmetricImport, setSensitiveSession, symmetricQr])
  useEffect(() => () => resetSensitiveSession(), [resetSensitiveSession])

  const createSymmetric = async () => {
    const parsed = keyNameSchema.safeParse(keyName)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "鍵名を確認してください。")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveKeyRecord(await createSymmetricKeyRecord(parsed.data, Date.now()))
      setKeyName("")
      await refreshKeys()
      toast.success("共通鍵を作成しました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const createPqIdentity = async () => {
    const parsed = keyNameSchema.safeParse(keyName)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "ID名を確認してください。")
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
      toast.success("ポスト量子IDを作成しました")
    } catch (caught) {
      setError(toAppError(caught, "ENCRYPTION_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const showSymmetricQr = async (record: StoredKeyRecord) => {
    setBusy(true)
    setError(null)
    try {
      const envelope = await buildSymmetricKeyEnvelope(record)
      setSymmetricQr({
        record,
        payload: encodeEnvelopeToPayload(envelope),
        name: `${record.name} QR`,
        acknowledged: false,
      })
    } catch (caught) {
      setError(toAppError(caught, "KEY_TYPE_MISMATCH").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const buildSymmetricArtifact = async (): Promise<StoredQrArtifact | null> => {
    if (!symmetricQr) return null
    const parsedName = qrNameSchema.safeParse(symmetricQr.name)
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "QR名を確認してください。")
      return null
    }
    return {
      id: generateArtifactId(),
      name: parsedName.data,
      kind: "symmetric-key",
      sensitivity: "secret",
      algorithm: "A256GCM",
      payload: symmetricQr.payload,
      payloadSha256: await payloadSha256Hex(symmetricQr.payload),
      byteLength: new TextEncoder().encode(symmetricQr.payload).byteLength,
      createdAt: Date.now(),
      keyId: symmetricQr.record.id,
    }
  }

  const saveSymmetricQr = async () => {
    if (!symmetricQr?.acknowledged) return
    setBusy(true)
    setError(null)
    try {
      const artifact = await buildSymmetricArtifact()
      if (!artifact) return
      await saveQrArtifact(artifact)
      toast.success("共通鍵QRを保存しました")
    } catch (caught) {
      if (caught instanceof AppError && caught.code === "DUPLICATE_QR") {
        const artifact = await buildSymmetricArtifact()
        if (artifact) setDuplicateArtifact(artifact)
        return
      }
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const saveDuplicateQr = async () => {
    if (!duplicateArtifact) return
    setBusy(true)
    setError(null)
    try {
      await saveQrArtifact(duplicateArtifact, { allowDuplicate: true })
      setDuplicateArtifact(null)
      toast.success("共通鍵QRを重複保存しました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const exportSymmetricQr = async (format: "png" | "svg") => {
    if (!symmetricQr?.acknowledged) return
    const parsedName = qrNameSchema.safeParse(symmetricQr.name)
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "QR名を確認してください。")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ecLevel = ecLevelFor("stored-key", preferences)
      const blob =
        format === "png"
          ? await qrPngBlob(symmetricQr.payload, {
              ecLevel,
              size: env.qrRenderSize,
            })
          : await qrSvgBlob(symmetricQr.payload, { ecLevel })
      triggerDownload(
        blob,
        buildExportFileName(parsedName.data, symmetricQr.record.id, format),
      )
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const copySymmetricQr = async () => {
    if (!symmetricQr?.acknowledged) return
    try {
      await copyTextToClipboard(symmetricQr.payload)
      toast.success("コピーしました。クリップボード同期に注意してください。")
    } catch {
      setError("コピーできませんでした。ブラウザーの権限を確認してください。")
    }
  }

  const showIdentityQr = async (
    identity: PostQuantumIdentity,
    kind: "bundle" | "kem" | "signing",
  ) => {
    setBusy(true)
    setError(null)
    try {
      assertUsableIdentity(identity)
      let artifactType: "pq-public-identity" | "pq-kem-public-key" | "pq-dsa-public-key"
      let artifactBytes: Uint8Array
      let title: string
      if (kind === "bundle") {
        artifactType = "pq-public-identity"
        artifactBytes = encodePublicIdentityBundleV2(buildPublicBundle(identity))
        title = `${identity.name} 公開鍵セット`
      } else if (kind === "kem") {
        artifactType = "pq-kem-public-key"
        artifactBytes = encodeKemPublicKeyEnvelopeV2({
          version: 2,
          type: "pq-kem-public-key",
          identityId: identity.id,
          name: identity.name,
          algorithm: identity.kem.algorithm,
          keyId: identity.kem.keyId,
          publicKey: identity.kem.publicKey,
          createdAt: identity.createdAt,
        })
        title = `${identity.name} 暗号化用公開鍵`
      } else {
        artifactType = "pq-dsa-public-key"
        artifactBytes = encodeDsaPublicKeyEnvelopeV2({
          version: 2,
          type: "pq-dsa-public-key",
          identityId: identity.id,
          name: identity.name,
          algorithm: identity.signing.algorithm,
          keyId: identity.signing.keyId,
          publicKey: identity.signing.publicKey,
          createdAt: identity.createdAt,
        })
        title = `${identity.name} 署名検証用公開鍵`
      }
      setFramedQr({
        title,
        outputName: `${title}-${formatSuggestedDate(Date.now())}`,
        frames: await splitIntoFrames({
          artifactType,
          artifactBytes,
          frameBytes: preferences.frameBytes,
        }),
      })
    } catch (caught) {
      setError(toAppError(caught, "QR_TOO_LARGE").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const rotate = async (identity: PostQuantumIdentity) => {
    setBusy(true)
    setError(null)
    try {
      const rotated = await rotateIdentity({
        client: getPqClient(),
        vaultKey: await getOrCreateVaultKey(),
        current: identity,
        now: Date.now(),
      })
      await saveRotation(rotated)
      await refreshPq()
      toast.success("IDをローテーションしました")
    } catch (caught) {
      setError(toAppError(caught, "ENCRYPTION_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (identity: PostQuantumIdentity) => {
    setBusy(true)
    try {
      await revokeIdentity(identity.id, Date.now())
      await refreshPq()
      toast.success("この端末でIDを失効しました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const removeIdentity = async (identity: PostQuantumIdentity) => {
    setBusy(true)
    setError(null)
    try {
      await deleteIdentity(identity.id)
      await refreshPq()
      toast.success("旧プロファイルIDを削除しました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
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
      toast.success("旧形式のRSA鍵を削除しました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
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
          `取込共通鍵-${formatSuggestedDate(Date.now())}`,
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
      setError(toAppError(caught, "INVALID_QR_PAYLOAD").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const importScannedPayload = async (payload: string) => {
    setBusy(true)
    setError(null)
    try {
      await importDecoded(decodePayload(payload))
    } catch (caught) {
      setError(toAppError(caught, "INVALID_QR_PAYLOAD").userMessage)
    } finally {
      setBusy(false)
    }
  }

  const savePendingSymmetricImport = async () => {
    if (!pendingSymmetricImport || !symmetricImportAcknowledged) return
    const parsedName = keyNameSchema.safeParse(symmetricImportName)
    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "鍵名を確認してください。")
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
      toast.success("共通鍵を取り込みました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
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
      toast.success(confirmed ? "指紋確認済みで保存しました" : "未確認のまま保存しました")
    } catch (caught) {
      setError(toAppError(caught, "STORAGE_FAILED").userMessage)
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
        <h2 className="text-[1.375rem] font-bold tracking-tight">鍵</h2>
        {(keysLoading || pqLoading || busy) && (
          <LoaderCircle aria-label="処理中" className="size-5 animate-spin" />
        )}
      </div>

      {legacyKeys.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>
            旧形式のRSA鍵 {legacyKeys.length} 件は v2 で使用不可、復元できません
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>旧暗号文は復号できません。鍵は通常の一覧や選択肢には表示しません。</p>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void removeLegacyKeys()}
            >
              <Trash2 aria-hidden="true" />
              旧形式の鍵を削除
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {(error || keysError || pqError) && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>操作を完了できません</AlertTitle>
          <AlertDescription>{error ?? keysError ?? pqError}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as KeysTab)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="symmetric">共通鍵</TabsTrigger>
          <TabsTrigger value="identity">ポスト量子ID</TabsTrigger>
          <TabsTrigger value="bundle">相手の公開鍵</TabsTrigger>
          <TabsTrigger value="scan">鍵を読み取る</TabsTrigger>
        </TabsList>

        <TabsContent value="symmetric" className="space-y-4">
          <CreateField
            label="共通鍵名"
            value={keyName}
            onChange={setKeyName}
            buttonLabel="共通鍵を作成"
            busy={busy}
            onCreate={() => void createSymmetric()}
          />
          {symmetricKeys.map((record) => (
            <Card key={record.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{record.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{record.id}</p>
                  </div>
                  <Badge>AES-256-GCM</Badge>
                </div>
                <Fingerprint label="鍵指紋" value={record.fingerprint} />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  disabled={busy}
                  onClick={() => void showSymmetricQr(record)}
                >
                  <QrCode aria-hidden="true" />
                  秘密鍵QRを表示
                </Button>
              </CardContent>
            </Card>
          ))}
          {!keysLoading && symmetricKeys.length === 0 && (
            <Empty text="共通鍵がありません。" />
          )}
        </TabsContent>

        <TabsContent value="identity" className="space-y-4">
          <Alert>
            <ShieldCheck aria-hidden="true" className="size-4" />
            <AlertTitle>experimental・未独立監査</AlertTitle>
            <AlertDescription>
              本リリースは maximum（ML-KEM-1024 / ML-DSA-87）のみです。
            </AlertDescription>
          </Alert>
          <CreateField
            label="ポスト量子ID名"
            value={keyName}
            onChange={setKeyName}
            buttonLabel="maximum IDを作成"
            busy={busy}
            onCreate={() => void createPqIdentity()}
          />
          {identityGroups.map(({ head, previous }) => (
            <IdentityCard
              key={head.id}
              identity={head}
              previous={previous}
              busy={busy}
              onShow={showIdentityQr}
              onRotate={rotate}
              onRevoke={revoke}
              onDelete={removeIdentity}
            />
          ))}
          {!pqLoading && identities.length === 0 && (
            <Empty text="ポスト量子IDがありません。" />
          )}
        </TabsContent>

        <TabsContent value="bundle" className="space-y-4">
          <BundleList
            bundles={bundles}
            busy={busy}
            refresh={refreshPq}
            setError={setError}
          />
        </TabsContent>

        <TabsContent value="scan" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key-payload">鍵ペイロード</Label>
            <Textarea
              id="key-payload"
              value={importPayload}
              onChange={(event) => setImportPayload(event.target.value)}
              placeholder="OCK1: / OCP2: / OCS2: / OCI2: を貼り付け"
              className="min-h-28 break-all font-mono"
            />
            <Button
              type="button"
              className="h-11 w-full"
              disabled={busy || !importPayload.trim()}
              onClick={() => void importPastedPayload()}
            >
              <KeyRound aria-hidden="true" />
              鍵を読み取る
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={busy || !camera}
              onClick={() => setScannerOpen(true)}
            >
              <QrCode aria-hidden="true" />
              単枚共通鍵QRを読み取る
            </Button>
          </div>
          <MultipartScanPanel
            session={scanSession}
            cameraAvailable={camera && !scannerOpen}
            title="鍵の複数QRを連続読み取り"
            onComplete={(completion) => handleCompletedArtifact(completion)}
          />
          {singleKeyRead && (
            <Alert>
              <CheckCircle2 aria-hidden="true" className="size-4" />
              <AlertTitle>単鍵を読み取りました</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  {singleKeyRead.type === "pq-kem-public-key"
                    ? "暗号化用公開鍵"
                    : "署名検証用公開鍵"}{" "}
                  / {singleKeyRead.algorithm}
                </p>
                <Fingerprint label="単鍵指紋" value={singleKeyFingerprint} />
                <p>
                  人物との対応を確認して永続利用するには、OCI2公開鍵セットを取り込んでください。
                </p>
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={framedQr !== null}
        onOpenChange={(open) => !open && setFramedQr(null)}
      >
        <DialogContent className="max-h-[95dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{framedQr?.title}</DialogTitle>
            <DialogDescription>
              すべてOCF2フレーム・誤り訂正Qで表示します。
            </DialogDescription>
          </DialogHeader>
          {framedQr && (
            <AnimatedQrFrames
              frames={framedQr.frames}
              frameIntervalMs={preferences.frameIntervalMs}
              outputName={framedQr.outputName}
              title={framedQr.title}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={symmetricQr !== null}
        onOpenChange={(open) => !open && setSymmetricQr(null)}
      >
        <DialogContent className="max-h-[95dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>共通鍵QR</DialogTitle>
            <DialogDescription>
              このQRには暗号化と復号に使える秘密鍵が含まれます。
            </DialogDescription>
          </DialogHeader>
          {symmetricQr && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTitle>機密情報</AlertTitle>
                <AlertDescription>
                  第三者に見せると、過去と将来の暗号文を復号されるおそれがあります。
                </AlertDescription>
              </Alert>
              <QrDisplay
                payload={symmetricQr.payload}
                ecLevel={ecLevelFor("stored-key", preferences)}
                size={env.qrRenderSize}
                title="共通鍵QR"
              />
              <div className="space-y-2">
                <Label htmlFor="symmetric-qr-name">QR名</Label>
                <Input
                  id="symmetric-qr-name"
                  value={symmetricQr.name}
                  maxLength={80}
                  onChange={(event) =>
                    setSymmetricQr({ ...symmetricQr, name: event.target.value })
                  }
                />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="secret-ack"
                  checked={symmetricQr.acknowledged}
                  onCheckedChange={(checked) =>
                    setSymmetricQr({ ...symmetricQr, acknowledged: checked === true })
                  }
                />
                <Label htmlFor="secret-ack">リスクを理解しました</Label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  className="h-11"
                  disabled={!symmetricQr.acknowledged || busy}
                  onClick={() => void saveSymmetricQr()}
                >
                  保存済み鍵QRへ保存
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={!symmetricQr.acknowledged || busy}
                  onClick={() => void exportSymmetricQr("png")}
                >
                  <Download aria-hidden="true" />
                  PNG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={!symmetricQr.acknowledged || busy}
                  onClick={() => void exportSymmetricQr("svg")}
                >
                  <FileCode2 aria-hidden="true" />
                  SVG
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  disabled={!symmetricQr.acknowledged || busy}
                  onClick={() => void copySymmetricQr()}
                >
                  <Clipboard aria-hidden="true" />
                  コピー
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pendingBundle !== null} onOpenChange={() => undefined}>
        <DialogContent
          className="max-h-[95dvh] max-w-lg overflow-y-auto [&>button.absolute]:hidden"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>別経路で指紋を比較してください</DialogTitle>
            <DialogDescription>
              取込を完了する前に、相手と通話・対面など別経路で full hex
              を照合します。自己署名だけでは人物を証明しません。
            </DialogDescription>
          </DialogHeader>
          {pendingBundle && (
            <div className="space-y-4">
              <Fingerprint
                label="Identity fingerprint"
                value={pendingBundle.identityFingerprint}
              />
              <Fingerprint
                label="ML-KEM fingerprint"
                value={pendingBundle.kem.fingerprint}
              />
              <Fingerprint
                label="ML-DSA fingerprint"
                value={pendingBundle.signing.fingerprint}
              />
              <div className="flex items-start gap-2">
                <Checkbox
                  id="fingerprint-confirmed"
                  checked={fingerprintChecked}
                  onCheckedChange={(checked) => setFingerprintChecked(checked === true)}
                />
                <Label htmlFor="fingerprint-confirmed">別経路で一致を確認した</Label>
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
              未確認のまま保存
            </Button>
            <Button
              type="button"
              disabled={busy || !fingerprintChecked}
              onClick={() => void savePendingBundle(true)}
            >
              確認して保存
            </Button>
          </DialogFooter>
        </DialogContent>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>共通鍵を取り込みます</DialogTitle>
            <DialogDescription>
              このペイロードには暗号化と復号に使える秘密鍵が含まれます。
            </DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertTitle>共有経路を確認してください</AlertTitle>
            <AlertDescription>
              第三者が同じ鍵を持つと、暗号文を復号されるおそれがあります。
            </AlertDescription>
          </Alert>
          <div className="space-y-2">
            <Label htmlFor="symmetric-import-name">鍵名</Label>
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
            <Label htmlFor="symmetric-import-ack">この鍵の共有経路を信頼しています</Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={busy || !symmetricImportAcknowledged}
              onClick={() => void savePendingSymmetricImport()}
            >
              共通鍵を保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={duplicateArtifact !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateArtifact(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>同じ内容の鍵QRが保存済みです</AlertDialogTitle>
            <AlertDialogDescription>
              確認後、別のIDで重複保存できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void saveDuplicateQr()}>
              重複して保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QrScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        target="symmetric-key"
        cameraAvailable={camera}
        onScan={(payload) => void importScannedPayload(payload)}
      />
    </section>
  )
}

function CreateField({
  label,
  value,
  onChange,
  buttonLabel,
  busy,
  onCreate,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  buttonLabel: string
  busy: boolean
  onCreate: () => void
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <Label htmlFor={`create-${buttonLabel}`}>{label}</Label>
        <Input
          id={`create-${buttonLabel}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={80}
        />
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
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-xs">{value}</p>
      <p className="font-mono text-sm">比較表示: {formatFingerprint(value)}</p>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function IdentityCard({
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
  onDelete: (identity: PostQuantumIdentity) => Promise<void>
}) {
  const supported = isUsableIdentity(identity)
  const old = identity.status !== "active"
  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <CardTitle className="flex items-start justify-between gap-3 text-base">
          <span>{identity.name}</span>
          <Badge variant={old || !supported ? "secondary" : "default"}>
            {supported ? identity.status : "非対応（旧プロファイル）"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <p className="text-xs text-muted-foreground">
          {!supported
            ? "非対応（旧プロファイル）: 暗号処理とQR再出力はできません。"
            : old
              ? "旧世代: 復号/検証専用"
              : "暗号化・署名に使用可能"}
        </p>
        <Fingerprint label="ID fingerprint" value={identity.identityFingerprint} />
        <Fingerprint
          label={`KEM ${identity.kem.algorithm}`}
          value={identity.kem.fingerprint}
        />
        <Fingerprint
          label={`Signing ${identity.signing.algorithm}`}
          value={identity.signing.fingerprint}
        />
        <p className="text-xs text-muted-foreground">
          作成: {formatDateTime(identity.createdAt)}
        </p>
        <div className="grid grid-cols-1 gap-2">
          {supported && !old && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onShow(identity, "bundle")}
              >
                <QrCode aria-hidden="true" />
                公開鍵セットQR
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void onShow(identity, "kem")}
              >
                <QrCode aria-hidden="true" />
                暗号化用単鍵QR
              </Button>
            </>
          )}
          {supported && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void onShow(identity, "signing")}
            >
              <QrCode aria-hidden="true" />
              署名検証用単鍵QR
            </Button>
          )}
          {supported && identity.status === "active" && (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void onRotate(identity)}
              >
                <RefreshCw aria-hidden="true" />
                ローテーション
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void onRevoke(identity)}
              >
                <Trash2 aria-hidden="true" />
                この端末で失効
              </Button>
            </>
          )}
          {!supported && (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void onDelete(identity)}
            >
              <Trash2 aria-hidden="true" />
              旧プロファイルIDを削除
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          失効はこの端末での利用停止であり、外部の相手には伝播しません。
        </p>
        {previous.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="group h-9 w-full justify-between px-2 text-xs text-muted-foreground"
              >
                旧世代 {previous.length} 件、復号専用
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
                        作成: {formatDateTime(generation.createdAt)}
                      </p>
                      <Badge variant="secondary">
                        {generationSupported
                          ? generation.status
                          : "非対応（旧プロファイル）"}
                      </Badge>
                    </div>
                    <p className="font-mono text-sm">
                      比較表示: {formatFingerprint(generation.identityFingerprint)}
                    </p>
                    {generationSupported ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void onShow(generation, "signing")}
                      >
                        <QrCode aria-hidden="true" />
                        署名検証用単鍵QR
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => void onDelete(generation)}
                      >
                        <Trash2 aria-hidden="true" />
                        削除
                      </Button>
                    )}
                  </div>
                )
              })}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}

function BundleList({
  bundles,
  busy,
  refresh,
  setError,
}: {
  bundles: PqPublicBundleRecord[]
  busy: boolean
  refresh: () => Promise<void>
  setError: (value: string | null) => void
}) {
  if (bundles.length === 0) return <Empty text="取り込んだ公開鍵セットがありません。" />
  return (
    <>
      {bundles.map((record) => {
        const supported = isUsableBundle(record)
        return (
          <Card key={record.recordId}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {record.trust === "fingerprint-confirmed"
                      ? (record.name ?? "確認済み公開鍵")
                      : "未確認の公開鍵"}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {record.identityId}
                  </p>
                </div>
                <Badge
                  variant={
                    supported && record.trust === "fingerprint-confirmed"
                      ? "default"
                      : "secondary"
                  }
                >
                  {supported
                    ? record.trust === "fingerprint-confirmed"
                      ? "人物確認済み"
                      : "unverified"
                    : "非対応（旧プロファイル）"}
                </Badge>
              </div>
              <Fingerprint
                label={`受信公開鍵 ${record.kem.algorithm}`}
                value={record.kem.fingerprint}
              />
              <Fingerprint
                label={`署名公開鍵 ${record.signing.algorithm}`}
                value={record.signing.fingerprint}
              />
              <Fingerprint
                label="Identity fingerprint"
                value={record.identityFingerprint}
              />
              {!supported && (
                <p className="text-sm text-destructive">
                  非対応（旧プロファイル）のため、削除以外の操作はできません。
                </p>
              )}
              <div className={`grid gap-2 ${supported ? "grid-cols-2" : "grid-cols-1"}`}>
                {supported && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void revokeBundle(record.recordId, Date.now())
                        .then(refresh)
                        .catch((caught) =>
                          setError(toAppError(caught, "STORAGE_FAILED").userMessage),
                        )
                    }
                  >
                    利用停止
                  </Button>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void deleteBundle(record.recordId)
                      .then(refresh)
                      .catch((caught) =>
                        setError(toAppError(caught, "STORAGE_FAILED").userMessage),
                      )
                  }
                >
                  削除
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </>
  )
}
