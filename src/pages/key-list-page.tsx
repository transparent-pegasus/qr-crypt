import { useMemo, useState } from "react"
import { LoaderCircle, Plus, ScanLine } from "lucide-react"
import { toast } from "sonner"
import { KeyAddDialog, type KeyAddMode } from "@/components/key-add-dialog"
import {
  isUsableIdentity,
  KeyDetailDialog,
  type KeySelection,
} from "@/components/key-detail-dialog"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
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
import {
  useI18n,
  useLocalizedMessage,
  type LocalizedMessage,
} from "@/i18n"
import type {
  PostQuantumIdentity,
  PqPublicBundleRecord,
  StoredKeyRecord,
} from "@/schemas/domain"
import {
  confirmBundleFingerprint,
  deleteBundle,
  revokeBundle,
} from "@/storage/pq-bundle-repository"

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
  const { language, t } = useI18n()
  const { keys, loading: keysLoading, error: keysError, refresh: refreshKeys } = useKeys()
  const {
    identities,
    bundles,
    loading: pqLoading,
    error: pqError,
    refresh: refreshPq,
  } = usePqRecords()
  const [selection, setSelection] = useState<KeySelection | null>(null)
  const [addMode, setAddMode] = useState<KeyAddMode | null>(null)
  // Kept apart from `selection` so a key created in the add modal shows its detail
  // there, instead of also opening the list's own detail dialog behind it.
  const [created, setCreated] = useState<KeySelection | null>(null)
  const [ownKeyFilter, setOwnKeyFilter] = useState<OwnKeyFilter>("all")
  const [bundleBusy, setBundleBusy] = useState(false)
  const [bundleError, setBundleError] = useState<LocalizedMessage | null>(null)
  const [bundleConfirmation, setBundleConfirmation] =
    useState<PqPublicBundleRecord | null>(null)
  const [bundleFingerprintChecked, setBundleFingerprintChecked] = useState(false)
  const localizedPqError = useLocalizedMessage(pqError)
  const localizedKeysError = useLocalizedMessage(keysError)
  const localizedBundleError = useLocalizedMessage(bundleError)
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
  const resolveDetail = (target: KeySelection | null) => {
    const group =
      target?.kind === "identity"
        ? identityGroups.find(({ head }) => head.id === target.id)
        : undefined
    const symmetric =
      target?.kind === "symmetric"
        ? symmetricKeys.find((record) => record.id === target.id)
        : undefined
    const missing =
      (target?.kind === "identity" && !pqLoading && group === undefined) ||
      (target?.kind === "symmetric" && !keysLoading && symmetric === undefined)
    return {
      selection: missing ? null : target,
      identity: group?.head,
      previous: group?.previous,
      symmetric,
    }
  }
  const listDetail = resolveDetail(selection)
  const createdDetail = resolveDetail(created)
  // Deleting from the modal's detail view leaves nothing to show, so close the whole
  // modal — the same thing the list's own detail dialog does by deriving `open`.
  if (created !== null && createdDetail.selection === null) {
    setCreated(null)
    setAddMode(null)
  }
  const settled = !keysLoading && !pqLoading

  const applyDetailChange = async (nextSelection: KeySelection) => {
    if (nextSelection.kind === "identity") await refreshPq()
    else await refreshKeys()
  }

  const mutateBundle = async (operation: () => Promise<void>) => {
    setBundleBusy(true)
    setBundleError(null)
    try {
      await operation()
      await refreshPq()
    } catch (caught) {
      setBundleError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBundleBusy(false)
    }
  }

  const closeBundleConfirmation = () => {
    setBundleConfirmation(null)
    setBundleFingerprintChecked(false)
  }

  const confirmStoredBundle = async () => {
    const record = bundleConfirmation
    if (record === null || !bundleFingerprintChecked) return
    setBundleBusy(true)
    setBundleError(null)
    try {
      await confirmBundleFingerprint(record.recordId, Date.now())
      await refreshPq()
      closeBundleConfirmation()
      toast.success(t("keyList.toast.bundleConfirmed"))
    } catch (caught) {
      setBundleError(toAppError(caught, "STORAGE_FAILED").code)
    } finally {
      setBundleBusy(false)
    }
  }

  return (
    <section
      className="mx-auto w-full max-w-md space-y-6 px-4 py-6"
      aria-busy={bundleBusy}
    >
      {(!settled || bundleBusy) && (
        <div className="flex justify-end">
          <LoaderCircle
            aria-label={t("common.loading")}
            className="size-5 animate-spin"
          />
        </div>
      )}

      {pqError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("keyList.error.identity")}</AlertTitle>
          <AlertDescription>{localizedPqError}</AlertDescription>
        </Alert>
      )}
      {keysError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("keyList.error.symmetric")}</AlertTitle>
          <AlertDescription>{localizedKeysError}</AlertDescription>
        </Alert>
      )}
      {bundleError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{t("keyList.error.peer")}</AlertTitle>
          <AlertDescription>{localizedBundleError}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="own">
        {/* One visual frame, two separate controls: the action buttons stay outside
            TabsList so its role="tablist" keeps listing only tabs. */}
        <div className="space-y-1 rounded-lg border bg-muted p-1">
          <TabsList className="grid h-9 w-full grid-cols-2 bg-transparent p-0">
            <TabsTrigger value="own" className="h-9 cursor-pointer">
              {t("keyList.tab.own")}
            </TabsTrigger>
            <TabsTrigger value="peer" className="h-9 cursor-pointer">
              {t("keyList.tab.peer")}
            </TabsTrigger>
          </TabsList>
          <div className="grid grid-cols-2 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("keyList.action.create")}
              className="h-9 w-full cursor-pointer"
              onClick={() => {
                setCreated(null)
                setAddMode("create")
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("keyList.action.import")}
              className="h-9 w-full cursor-pointer"
              onClick={() => {
                setCreated(null)
                setAddMode("import")
              }}
            >
              <ScanLine aria-hidden="true" />
            </Button>
          </div>
        </div>

        <TabsContent value="own" className="mt-6 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="own-key-kind-filter">{t("keyList.filter.label")}</Label>
            <Select
              value={ownKeyFilter}
              onValueChange={(value) => setOwnKeyFilter(value as OwnKeyFilter)}
            >
              <SelectTrigger id="own-key-kind-filter" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("keyList.filter.all")}</SelectItem>
                <SelectItem value="pq-identity">
                  {t("keyList.filter.pqIdentity")}
                </SelectItem>
                <SelectItem value="symmetric">
                  {t("keyList.filter.symmetric")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filteredOwnKeyItems.map((item) => {
            if (item.kind === "identity") {
              const { head, previous } = item.group
              const supported = isUsableIdentity(head)
              return (
                <button
                  key={head.id}
                  type="button"
                  className="select-none touch-manipulation w-full cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2"
                  onClick={() => setSelection({ kind: "identity", id: head.id })}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{head.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("keyList.item.identityMeta", {
                          datetime: formatDateTime(head.createdAt, language),
                        })}
                      </p>
                    </div>
                    <div className="max-w-[45%] shrink-0 text-right">
                      <Badge
                        variant={
                          head.status === "active" && supported
                            ? "default"
                            : "secondary"
                        }
                      >
                        {supported
                          ? t(`keyStatus.${head.status}`)
                          : t("keyDetail.badge.legacyProfile")}
                      </Badge>
                      {previous.length > 0 && (
                        <p className="mt-1 text-xs font-medium text-destructive">
                          {t("keyList.item.supersededWarning", {
                            count: previous.length,
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            }

            const { record } = item
            return (
              <button
                key={record.id}
                type="button"
                className="select-none touch-manipulation w-full cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2"
                onClick={() => setSelection({ kind: "symmetric", id: record.id })}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{record.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("keyList.item.symmetricMeta", {
                        datetime: formatDateTime(record.createdAt, language),
                      })}
                    </p>
                  </div>
                  {/* Symmetric records carry no lifecycle state; the badge column is
                      state everywhere, and the algorithm already shows in the meta line. */}
                  <Badge>{t("keyStatus.active")}</Badge>
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
                    ? t("keyList.empty.ownAll")
                    : t("keyList.empty.ownFiltered")
                }
              />
            )}
        </TabsContent>

        <TabsContent value="peer" className="mt-6 space-y-3">
          {!pqLoading && !pqError && (
            <BundleList
              bundles={bundles}
              busy={bundleBusy}
              onConfirm={(record) => {
                setBundleConfirmation(record)
                setBundleFingerprintChecked(false)
              }}
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

      <KeyAddDialog
        mode={addMode}
        detail={
          created === null
            ? null
            : {
                ...createdDetail,
                onChanged: async (nextSelection) => {
                  await applyDetailChange(nextSelection)
                  setCreated(nextSelection)
                },
              }
        }
        onOpenChange={(open) => {
          if (open) return
          setAddMode(null)
          setCreated(null)
        }}
        onCreated={async (nextSelection) => {
          await applyDetailChange(nextSelection)
          setCreated(nextSelection)
        }}
        onImported={async () => {
          await Promise.all([refreshKeys(), refreshPq()])
        }}
      />

      <KeyDetailDialog
        {...listDetail}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
        onChanged={async (nextSelection) => {
          await applyDetailChange(nextSelection)
          setSelection(nextSelection)
        }}
      />

      <Dialog
        open={bundleConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !bundleBusy) closeBundleConfirmation()
        }}
      >
        <NoAutofocusDialogContent className="max-h-[95dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("keyList.bundle.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("keyList.bundle.confirmBody")}
            </DialogDescription>
          </DialogHeader>
          {bundleConfirmation !== null && (
            <div className="space-y-4">
              <Fingerprint
                label={t("common.identityFingerprint")}
                value={bundleConfirmation.identityFingerprint}
              />
              <Fingerprint
                label={t("keyList.bundle.fingerprintKem", {
                  algorithm: bundleConfirmation.kem.algorithm,
                })}
                value={bundleConfirmation.kem.fingerprint}
              />
              <Fingerprint
                label={t("keyList.bundle.fingerprintSigning", {
                  algorithm: bundleConfirmation.signing.algorithm,
                })}
                value={bundleConfirmation.signing.fingerprint}
              />
              <div className="flex items-start gap-2">
                <Checkbox
                  id="stored-bundle-fingerprint-confirmed"
                  checked={bundleFingerprintChecked}
                  disabled={bundleBusy}
                  onCheckedChange={(checked) =>
                    setBundleFingerprintChecked(checked === true)
                  }
                />
                <Label htmlFor="stored-bundle-fingerprint-confirmed">
                  {t("keyList.bundle.confirmCheck")}
                </Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={bundleBusy}
              onClick={closeBundleConfirmation}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={bundleBusy || !bundleFingerprintChecked}
              onClick={() => void confirmStoredBundle()}
            >
              {t("keyList.bundle.confirmSubmit")}
            </Button>
          </DialogFooter>
        </NoAutofocusDialogContent>
      </Dialog>
    </section>
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

function BundleList({
  bundles,
  busy,
  onConfirm,
  onRevoke,
  onDelete,
}: {
  bundles: PqPublicBundleRecord[]
  busy: boolean
  onConfirm: (record: PqPublicBundleRecord) => void
  onRevoke: (recordId: string) => Promise<void>
  onDelete: (recordId: string) => Promise<void>
}) {
  const { t } = useI18n()
  if (bundles.length === 0) {
    return <Empty text={t("keyList.bundle.empty")} />
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
                      ? (record.name ?? t("keyList.bundle.nameConfirmed"))
                      : t("keyList.bundle.nameUnverified")}
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
                      ? t("keyList.bundle.badge.confirmed")
                      : t("keyList.bundle.badge.unverified")
                    : t("keyDetail.badge.legacyProfile")}
                </Badge>
              </div>
              <Fingerprint
                label={t("keyList.bundle.fingerprintKem", {
                  algorithm: record.kem.algorithm,
                })}
                value={record.kem.fingerprint}
              />
              <Fingerprint
                label={t("keyList.bundle.fingerprintSigning", {
                  algorithm: record.signing.algorithm,
                })}
                value={record.signing.fingerprint}
              />
              <Fingerprint
                label={t("common.identityFingerprint")}
                value={record.identityFingerprint}
              />
              {!supported && (
                <p className="text-sm text-destructive">
                  {t("keyList.bundle.legacyNote")}
                </p>
              )}
              {record.trust !== "fingerprint-confirmed" && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => onConfirm(record)}
                >
                  {t("keyList.bundle.confirmOpen")}
                </Button>
              )}
              <div className={`grid gap-2 ${supported ? "grid-cols-2" : "grid-cols-1"}`}>
                {supported && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void onRevoke(record.recordId)}
                  >
                    {t("keyList.bundle.revoke")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void onDelete(record.recordId)}
                >
                  {t("common.delete")}
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
