import { useMemo, useState } from "react"
import { LoaderCircle, Plus, ScanLine } from "lucide-react"
import { toast } from "sonner"
import { KeyAddDialog, type KeyAddMode } from "@/components/key-add-dialog"
import {
  KeyDetailDialog,
  type KeySelection,
} from "@/components/key-detail-dialog"
import {
  isUsableBundle,
  isUsableIdentity,
} from "@/components/key-detail/identity-policy"
import { Fingerprint } from "@/components/fingerprint"
import { NoAutofocusDialogContent } from "@/components/no-autofocus-dialog-content"
import { PeerBundleDetailDialog } from "@/components/peer-bundle-detail-dialog"
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
import { groupSymmetricKeys } from "@/crypto/key-generation"
import { formatDateTime } from "@/features/presentation"
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

interface SymmetricGroup {
  head: StoredKeyRecord
  previous: StoredKeyRecord[]
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
      group: SymmetricGroup
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
  const [tab, setTab] = useState<"own" | "peer">("own")
  const [ownKeyFilter, setOwnKeyFilter] = useState<OwnKeyFilter>("all")
  const [bundleBusy, setBundleBusy] = useState(false)
  const [bundleError, setBundleError] = useState<LocalizedMessage | null>(null)
  const [bundleDetailId, setBundleDetailId] = useState<string | null>(null)
  const [bundleConfirmation, setBundleConfirmation] =
    useState<PqPublicBundleRecord | null>(null)
  const [bundleRevocation, setBundleRevocation] = useState<string | null>(null)
  const [bundleFingerprintChecked, setBundleFingerprintChecked] = useState(false)
  const localizedPqError = useLocalizedMessage(pqError)
  const localizedKeysError = useLocalizedMessage(keysError)
  const localizedBundleError = useLocalizedMessage(bundleError)
  const bundleDetail =
    bundleDetailId === null
      ? null
      : (bundles.find((record) => record.recordId === bundleDetailId) ?? null)
  if (bundleDetailId !== null && !pqLoading && bundleDetail === null) {
    setBundleDetailId(null)
  }
  const symmetricKeys = useMemo(
    () => keys.filter((key) => key.kind === "symmetric"),
    [keys],
  )
  const identityGroups = useMemo(() => groupIdentities(identities), [identities])
  const symmetricGroups = useMemo(
    () => groupSymmetricKeys(symmetricKeys),
    [symmetricKeys],
  )
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
        ...symmetricGroups.map(
          (group): OwnKeyItem => ({
            kind: "symmetric",
            createdAt: group.head.createdAt,
            group,
          }),
        ),
      ].sort((left, right) => right.createdAt - left.createdAt),
    [identityGroups, symmetricGroups],
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
    const symmetricGroup =
      target?.kind === "symmetric"
        ? symmetricGroups.find(({ head }) => head.id === target.id)
        : undefined
    const missing =
      (target?.kind === "identity" && !pqLoading && group === undefined) ||
      (target?.kind === "symmetric" &&
        !keysLoading &&
        symmetricGroup === undefined)
    return {
      selection: missing ? null : target,
      identity: group?.head,
      previous: group?.previous,
      symmetric: symmetricGroup?.head,
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

      <Tabs value={tab} onValueChange={(value) => setTab(value === "peer" ? "peer" : "own")}>
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="own" className="h-9 cursor-pointer">
            {t("keyList.tab.own")}
          </TabsTrigger>
          <TabsTrigger value="peer" className="h-9 cursor-pointer">
            {t("keyList.tab.peer")}
          </TabsTrigger>
        </TabsList>

        {/* One action per tab, outside TabsList so its role="tablist" keeps listing
            only tabs. Own keys are the ones this device creates; a peer's key can
            only arrive from outside. */}
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-11 w-full cursor-pointer whitespace-normal"
          onClick={() => {
            setCreated(null)
            setAddMode(tab === "own" ? "create" : "import")
          }}
        >
          {tab === "own" ? (
            <Plus aria-hidden="true" />
          ) : (
            <ScanLine aria-hidden="true" />
          )}
          {t(tab === "own" ? "keyList.action.create" : "keyList.action.import")}
        </Button>

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

            const { head, previous } = item.group
            return (
              <button
                key={head.id}
                type="button"
                className="select-none touch-manipulation w-full cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2"
                onClick={() => setSelection({ kind: "symmetric", id: head.id })}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{head.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("keyList.item.symmetricMeta", {
                        datetime: formatDateTime(head.createdAt, language),
                      })}
                    </p>
                  </div>
                  <div className="max-w-[45%] shrink-0 text-right">
                    <Badge
                      variant={head.status === "active" ? "default" : "secondary"}
                    >
                      {t(`keyStatus.${head.status}`)}
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
            <BundleList bundles={bundles} onSelect={setBundleDetailId} />
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

      <PeerBundleDetailDialog
        bundle={bundleDetail}
        supported={bundleDetail === null ? false : isUsableBundle(bundleDetail)}
        busy={bundleBusy}
        onOpenChange={(open) => {
          if (!open) setBundleDetailId(null)
        }}
        onConfirm={(record) => {
          setBundleDetailId(null)
          setBundleConfirmation(record)
          setBundleFingerprintChecked(false)
        }}
        onRevoke={(recordId) => {
          setBundleDetailId(null)
          setBundleRevocation(recordId)
        }}
        onDelete={(recordId) => {
          setBundleDetailId(null)
          void mutateBundle(() => deleteBundle(recordId))
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

      <AlertDialog
        open={bundleRevocation !== null}
        onOpenChange={(open) => {
          if (!open && !bundleBusy) setBundleRevocation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("keyList.bundle.revokeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("keyList.bundle.revokeBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={bundleBusy}
              onClick={() => {
                const recordId = bundleRevocation
                if (recordId === null) return
                setBundleRevocation(null)
                void mutateBundle(() => revokeBundle(recordId, Date.now()))
              }}
            >
              {t("keyList.bundle.revokeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function BundleList({
  bundles,
  onSelect,
}: {
  bundles: PqPublicBundleRecord[]
  onSelect: (recordId: string) => void
}) {
  const { language, t } = useI18n()
  if (bundles.length === 0) {
    return <Empty text={t("keyList.bundle.empty")} />
  }

  return (
    <>
      {bundles.map((record) => {
        const supported = isUsableBundle(record)
        const confirmed = record.trust === "fingerprint-confirmed"
        return (
          <button
            key={record.recordId}
            type="button"
            className="select-none touch-manipulation w-full cursor-pointer rounded-xl border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2"
            onClick={() => onSelect(record.recordId)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {confirmed
                    ? (record.name ?? t("keyList.bundle.nameConfirmed"))
                    : t("keyList.bundle.nameUnverified")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("keyList.bundle.itemMeta", {
                    datetime: formatDateTime(record.importedAt, language),
                  })}
                </p>
              </div>
              <div className="max-w-[45%] shrink-0 text-right">
                <Badge variant={supported && confirmed ? "default" : "secondary"}>
                  {supported
                    ? confirmed
                      ? t("keyList.bundle.badge.confirmed")
                      : t("keyList.bundle.badge.unverified")
                    : t("keyDetail.badge.legacyProfile")}
                </Badge>
              </div>
            </div>
          </button>
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
