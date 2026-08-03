import { ChevronDown, QrCode, RefreshCw, Trash2 } from "lucide-react"
import { Fingerprint } from "@/components/fingerprint"
import { isUsableIdentity } from "@/components/key-detail/identity-policy"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { formatDateTime, formatFingerprint } from "@/features/presentation"
import { useI18n } from "@/i18n"
import type { PostQuantumIdentity } from "@/schemas/domain"

export function IdentityDetails({
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
  onShow: (identity: PostQuantumIdentity) => Promise<void>
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
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy}
            onClick={() => void onShow(identity)}
          >
            <QrCode aria-hidden="true" />
            {t("keyDetail.button.showPublicKeyQr")}
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
