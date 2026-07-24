import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import { formatFingerprint, formatSuggestedDate } from "@/features/presentation"
import { useKeys } from "@/hooks/use-keys"
import { usePqCryptoClient } from "@/hooks/use-pq-crypto-client"
import { usePqRecords } from "@/hooks/use-pq-records"
import { usePreferences } from "@/hooks/use-preferences"
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
  deleteBundle,
  revokeBundle,
  saveBundle,
} from "@/storage/pq-bundle-repository"
import {
  saveIdentity,
} from "@/storage/pq-identity-repository"

type KeysTab = "create" | "import"
type CreateKeyKind = "pq-identity" | "symmetric"

type SingleKeyRead = KemPublicKeyEnvelopeV2 | DsaPublicKeyEnvelopeV2

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
  const { setSensitiveSession } = useSensitiveSession()
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
  const [tab, setTab] = useState<KeysTab>("create")
  const [createKind, setCreateKind] = useState<CreateKeyKind>("pq-identity")
  const [keyName, setKeyName] = useState("")
  const [importPayload, setImportPayload] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setError(parsed.error.issues[0]?.message ?? "鍵名を確認してください。")
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
      setSelection({ kind: "identity", id: identity.id })
      toast.success("ポスト量子IDを作成しました")
    } catch (caught) {
      setError(toAppError(caught, "ENCRYPTION_FAILED").userMessage)
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
        <h2 className="text-[1.375rem] font-bold tracking-tight">鍵追加</h2>
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
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="create" className="h-9 cursor-pointer px-1 text-sm">
            鍵を作成
          </TabsTrigger>
          <TabsTrigger value="import" className="h-9 cursor-pointer px-1 text-sm">
            鍵を読み込む
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="mt-6 space-y-4">
          <CreateField
            kind={createKind}
            onKindChange={setCreateKind}
            value={keyName}
            onChange={setKeyName}
            busy={busy}
            onCreate={() =>
              void (createKind === "pq-identity" ? createPqIdentity() : createSymmetric())
            }
          />
        </TabsContent>

        <TabsContent value="import" className="mt-6 space-y-4">
          <QrScannerModal
            triggerLabel="鍵QRを読み取る"
            singleTargets={["symmetric-key"]}
            cameraAvailable={camera}
            title="鍵QRを読み取る"
            onSingleScan={(_target, payload) => importScannedPayload(payload)}
            multipart={{
              session: scanSession,
              onComplete: (completion) => handleCompletedArtifact(completion),
            }}
          />
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
          </div>
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
          <BundleList
            bundles={bundles}
            busy={busy}
            refresh={refreshPq}
            setError={setError}
          />
          {!pqLoading && bundles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              上のQR読取またはペイロード貼付から公開鍵セットを取り込めます。
            </p>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={pendingBundle !== null} onOpenChange={() => undefined}>
        <NoAutofocusDialogContent
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
  const pq = kind === "pq-identity"
  const nameLabel = pq ? "ポスト量子ID名" : "共通鍵名"
  const buttonLabel = pq ? "ポスト量子IDを作成" : "共通鍵を作成"
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="space-y-2">
          <Label htmlFor="create-key-kind">種類</Label>
          <Select
            value={kind}
            onValueChange={(value) => onKindChange(value as CreateKeyKind)}
          >
            <SelectTrigger id="create-key-kind" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pq-identity">ポスト量子ID</SelectItem>
              <SelectItem value="symmetric">共通鍵</SelectItem>
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
          <Alert>
            <ShieldCheck aria-hidden="true" className="size-4" />
            <AlertDescription className="font-medium leading-none tracking-tight">
              experimental・未独立監査
            </AlertDescription>
          </Alert>
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
