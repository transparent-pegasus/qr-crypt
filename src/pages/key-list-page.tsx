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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime } from "@/features/presentation"
import { useKeys } from "@/hooks/use-keys"
import { usePqRecords } from "@/hooks/use-pq-records"
import type { PostQuantumIdentity } from "@/schemas/domain"

interface IdentityGroup {
  head: PostQuantumIdentity
  previous: PostQuantumIdentity[]
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

export function KeyListPage() {
  const { keys, loading: keysLoading, error: keysError, refresh: refreshKeys } = useKeys()
  const {
    identities,
    loading: pqLoading,
    error: pqError,
    refresh: refreshPq,
  } = usePqRecords()
  const [selection, setSelection] = useState<KeySelection | null>(null)
  const symmetricKeys = useMemo(
    () => keys.filter((key) => key.kind === "symmetric"),
    [keys],
  )
  const identityGroups = useMemo(() => groupIdentities(identities), [identities])
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

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[1.375rem] font-bold tracking-tight">鍵一覧</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            メッセージ暗号文はアプリ内へ保存しません。
          </p>
        </div>
        {!settled && <LoaderCircle aria-label="読込中" className="size-5 animate-spin" />}
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

      <Tabs defaultValue="pq-identity">
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="pq-identity" className="h-9 cursor-pointer">
            ポスト量子ID
          </TabsTrigger>
          <TabsTrigger value="symmetric" className="h-9 cursor-pointer">
            共通鍵
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pq-identity" className="mt-6 space-y-3">
          {identityGroups.map(({ head }) => {
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
          })}
          {settled && !pqError && identityGroups.length === 0 && (
            <Empty text="ポスト量子IDがありません。" />
          )}
        </TabsContent>

        <TabsContent value="symmetric" className="mt-6 space-y-3">
          {symmetricKeys.map((record) => (
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
          ))}
          {settled && !keysError && symmetricKeys.length === 0 && (
            <Empty text="共通鍵がありません。" />
          )}
        </TabsContent>
      </Tabs>

      {settled &&
        !keysError &&
        !pqError &&
        identityGroups.length === 0 &&
        symmetricKeys.length === 0 && (
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

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
