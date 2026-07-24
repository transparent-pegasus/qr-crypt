import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { LoaderCircle } from "lucide-react"
import {
  isUsableIdentity,
  KeyDetailDialog,
  type KeySelection,
} from "@/components/key-detail-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toAppError } from "@/crypto/errors"
import { assertActiveSuite, resolveSuite } from "@/crypto/pq/suites"
import { formatDateTime, formatFingerprint } from "@/features/presentation"
import { useKeys } from "@/hooks/use-keys"
import { usePqRecords } from "@/hooks/use-pq-records"
import type {
  PostQuantumIdentity,
  PqPublicBundleRecord,
  StoredKeyRecord,
} from "@/schemas/domain"
import { deleteBundle, revokeBundle } from "@/storage/pq-bundle-repository"

interface IdentityGroup {
  head: PostQuantumIdentity
  previous: PostQuantumIdentity[]
}

type OwnKeyFilter = "all" | "pq-identity" | "symmetric"

type OwnKeyItem =
  | {
      kind: "identity"
      createdAt: number
      group: IdentityGroup
    }
  | {
      kind: "symmetric"
      createdAt: number
      record: StoredKeyRecord
    }

function groupIdentities(identities: PostQuantumIdentity[]): IdentityGroup[] {
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
}

function isUsableBundle(bundle: PqPublicBundleRecord): boolean {
  try {
    assertActiveSuite(resolveSuite(bundle.kem.algorithm, bundle.signing.algorithm))
    return true
  } catch {
    return false
  }
}

export function KeyListPage() {
  const { keys, loading: keysLoading, error: keysError, refresh: refreshKeys } = useKeys()
  const {
    identities,
    bundles,
    loading: pqLoading,
    error: pqError,
    refresh: refreshPq,
  } = usePqRecords()
  const [selection, setSelection] = useState<KeySelection | null>(null)
  const [ownKeyFilter, setOwnKeyFilter] = useState<OwnKeyFilter>("all")
  const [bundleBusy, setBundleBusy] = useState(false)
  const [bundleError, setBundleError] = useState<string | null>(null)
  const symmetricKeys = useMemo(
    () => keys.filter((key) => key.kind === "symmetric"),
    [keys],
  )
  const identityGroups = useMemo(() => groupIdentities(identities), [identities])
  const ownKeyItems = useMemo<OwnKeyItem[]>(
    () =>
      [
        ...identityGroups.map(
          (group): OwnKeyItem => ({
            kind: "identity",
            createdAt: group.head.createdAt,
            group,
          }),
        ),
        ...symmetricKeys.map(
          (record): OwnKeyItem => ({
            kind: "symmetric",
            createdAt: record.createdAt,
            record,
          }),
        ),
      ].sort((left, right) => right.createdAt - left.createdAt),
    [identityGroups, symmetricKeys],
  )
  const filteredOwnKeyItems = useMemo(
    () =>
      ownKeyFilter === "all"
        ? ownKeyItems
        : ownKeyItems.filter(({ kind }) =>
            ownKeyFilter === "pq-identity"
              ? kind === "identity"
              : kind === "symmetric",
          ),
    [ownKeyFilter, ownKeyItems],
  )
  const selectedGroup =
    selection?.kind === "identity"
      ? identityGroups.find(({ head }) => head.id === selection.id)
      : undefined
  const selectedSymmetric =
    selection?.kind === "symmetric"
      ? symmetricKeys.find((record) => record.id === selection.id)
      : undefined
  const dialogSelection =
    (selection?.kind === "identity" && !pqLoading && selectedGroup === undefined) ||
    (selection?.kind === "symmetric" && !keysLoading && selectedSymmetric === undefined)
      ? null
      : selection
  const settled = !keysLoading && !pqLoading

  const mutateBundle = async (operation: () => Promise<void>) => {
    setBundleBusy(true)
    setBundleError(null)
    try {
      await operation()
      await refreshPq()
    } catch (caught) {
      setBundleError(toAppError(caught, "STORAGE_FAILED").userMessage)
    } finally {
      setBundleBusy(false)
    }
  }

  return (
    <section
      className="mx-auto w-full max-w-md space-y-6 px-4 py-6"
      aria-busy={bundleBusy}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[1.375rem] font-bold tracking-tight">鍵一覧</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            メッセージ暗号文はアプリ内へ保存しません。
          </p>
        </div>
        {(!settled || bundleBusy) && (
          <LoaderCircle aria-label="読込中" className="size-5 animate-spin" />
        )}
      </div>

      {pqError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>ポスト量子IDを読み込めません</AlertTitle>
          <AlertDescription>{pqError}</AlertDescription>
        </Alert>
      )}
      {keysError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>共通鍵を読み込めません</AlertTitle>
          <AlertDescription>{keysError}</AlertDescription>
        </Alert>
      )}
      {bundleError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>相手の鍵を更新できません</AlertTitle>
          <AlertDescription>{bundleError}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="own">
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="own" className="h-9 cursor-pointer">
            自分の鍵
          </TabsTrigger>
          <TabsTrigger value="peer" className="h-9 cursor-pointer">
            相手の鍵
          </TabsTrigger>
        </TabsList>

        <TabsContent value="own" className="mt-6 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="own-key-kind-filter">種別</Label>
            <Select
              value={ownKeyFilter}
              onValueChange={(value) => setOwnKeyFilter(value as OwnKeyFilter)}
            >
              <SelectTrigger id="own-key-kind-filter" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                <SelectItem value="pq-identity">ポスト量子ID</SelectItem>
                <SelectItem value="symmetric">共通鍵</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filteredOwnKeyItems.map((item) => {
            if (item.kind === "identity") {
              const { head } = item.group
              const supported = isUsableIdentity(head)
              return (
                <button
                  key={head.id}
                  type="button"
                  className="w-full cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2"
                  onClick={() => setSelection({ kind: "identity", id: head.id })}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{head.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        ポスト量子ID · {formatDateTime(head.createdAt)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        head.status === "active" && supported ? "default" : "secondary"
                      }
                    >
                      {supported ? head.status : "非対応（旧プロファイル）"}
                    </Badge>
                  </div>
                </button>
              )
            }

            const { record } = item
            return (
              <button
                key={record.id}
                type="button"
                className="w-full cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2"
                onClick={() => setSelection({ kind: "symmetric", id: record.id })}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{record.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      共通鍵 · {formatDateTime(record.createdAt)}
                    </p>
                  </div>
                  <Badge>AES-256-GCM</Badge>
                </div>
              </button>
            )
          })}
          {settled &&
            !keysError &&
            !pqError &&
            filteredOwnKeyItems.length === 0 && (
              <Empty
                text={
                  ownKeyFilter === "all"
                    ? "自分の鍵がありません。"
                    : "選択した種別の鍵がありません。"
                }
              />
            )}
        </TabsContent>

        <TabsContent value="peer" className="mt-6 space-y-3">
          {!pqLoading && !pqError && (
            <BundleList
              bundles={bundles}
              busy={bundleBusy}
              onRevoke={(recordId) =>
                mutateBundle(() => revokeBundle(recordId, Date.now()))
              }
              onDelete={(recordId) =>
                mutateBundle(() => deleteBundle(recordId))
              }
            />
          )}
        </TabsContent>
      </Tabs>

      {settled &&
        !keysError &&
        !pqError &&
        ownKeyItems.length === 0 && (
          <Card>
            <CardContent className="space-y-4 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                鍵がありません。鍵ページから作成できます。
              </p>
              <Button asChild className="h-11">
                <Link to="/keys">鍵ページを開く</Link>
              </Button>
            </CardContent>
          </Card>
        )}

      <KeyDetailDialog
        selection={dialogSelection}
        identity={selectedGroup?.head}
        previous={selectedGroup?.previous}
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

function Fingerprint({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-xs">{value}</p>
      <p className="font-mono text-sm">比較表示: {formatFingerprint(value)}</p>
    </div>
  )
}

function BundleList({
  bundles,
  busy,
  onRevoke,
  onDelete,
}: {
  bundles: PqPublicBundleRecord[]
  busy: boolean
  onRevoke: (recordId: string) => Promise<void>
  onDelete: (recordId: string) => Promise<void>
}) {
  if (bundles.length === 0) {
    return <Empty text="取り込んだ公開鍵セットがありません。" />
  }

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
                    onClick={() => void onRevoke(record.recordId)}
                  >
                    利用停止
                  </Button>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void onDelete(record.recordId)}
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

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
