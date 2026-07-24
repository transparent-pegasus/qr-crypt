import { useEffect, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Database,
  Eraser,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import { armMaintenanceToken } from "@/app/boot/boot-controller"
import {
  useFeatureSupport,
  useTheme,
  useTransientClear,
  type Theme,
} from "@/app/providers"
import { usePwaOfflineReady } from "@/components/pwa-offline-ready"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useKeys } from "@/hooks/use-keys"
import { usePreferences } from "@/hooks/use-preferences"
import {
  DELETE_ALL_CONFIRMATION,
  KEEP_KEYS_CONFIRMATION,
  useI18n,
  type MessageKey,
} from "@/i18n"
import type { Preferences, QrEcLevel, UiAlgorithm } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  FRAME_INTERVAL_MS_MAX,
  FRAME_INTERVAL_MS_MIN,
  FRAME_INTERVAL_MS_STEP,
  isFrameIntervalMs,
  RESET_CHURN_MB_MAX,
  RESET_CHURN_MB_MIN,
  TRANSFER_TIMEOUT_MINUTES_MAX,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
import { deleteEntireDatabase } from "@/storage/database"
import { clearAllKeys } from "@/storage/key-repository"
import { clearAllIdentities } from "@/storage/pq-identity-repository"

type TypedDeleteAction = "keys" | "reset"

export function SettingsPage() {
  const { language, setLanguage, t } = useI18n()
  const features = useFeatureSupport()
  const { theme, setTheme } = useTheme()
  const { clearTransient } = useTransientClear()
  const { refresh: refreshKeys } = useKeys()
  const {
    preferences,
    loading: preferencesLoading,
    error: preferencesError,
    updatePreferences,
  } = usePreferences()
  const pwa = usePwaOfflineReady()
  const [error, setError] = useState<MessageKey | null>(null)
  const [typedAction, setTypedAction] = useState<TypedDeleteAction | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [securityOpen, setSecurityOpen] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [maintenanceConfirmation, setMaintenanceConfirmation] = useState("")
  const [maintenanceAcknowledged, setMaintenanceAcknowledged] = useState(false)
  const [navigatorOnline, setNavigatorOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const sync = () => setNavigatorOnline(navigator.onLine)
    window.addEventListener("online", sync)
    window.addEventListener("offline", sync)
    return () => {
      window.removeEventListener("online", sync)
      window.removeEventListener("offline", sync)
    }
  }, [])

  const savePreference = async (patch: Partial<Preferences>) => {
    try {
      await updatePreferences(patch)
      toast.success(t("settings.toast.saved"))
    } catch {
      setError("settings.error.saveFailed")
    }
  }

  const clearTransientData = () => {
    clearTransient()
    toast.success(t("settings.toast.plaintextCleared"))
  }

  const performTypedDelete = async () => {
    if (!typedAction || deleteConfirmation !== DELETE_ALL_CONFIRMATION) return
    setWorking(true)
    try {
      if (typedAction === "keys") {
        await Promise.all([clearAllKeys(), clearAllIdentities()])
        await refreshKeys()
        toast.success(t("settings.toast.keysCleared"))
      } else {
        await deleteEntireDatabase()
        const keysToRemove: string[] = []
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index)
          if (key?.startsWith("oc-")) keysToRemove.push(key)
        }
        for (const key of keysToRemove) window.localStorage.removeItem(key)
        clearTransient()
        await refreshKeys()
        toast.success(t("boot.wiped.body"))
      }
      setTypedAction(null)
      setDeleteConfirmation("")
    } catch {
      setError("settings.error.deleteFailed")
    } finally {
      setWorking(false)
    }
  }

  const saveIntegerPreference = (
    key: "frameBytes" | "frameIntervalMs" | "transferTimeoutMinutes" | "resetChurnMb",
    raw: string,
    minimum: number,
    maximum: number,
    isAllowed: (value: number) => boolean = () => true,
  ) => {
    const value = Number(raw)
    if (
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum &&
      isAllowed(value)
    ) {
      void savePreference({ [key]: value })
    }
  }

  const armMaintenance = async () => {
    if (
      navigatorOnline ||
      maintenanceConfirmation !== KEEP_KEYS_CONFIRMATION ||
      !maintenanceAcknowledged
    ) {
      return
    }
    setWorking(true)
    setError(null)
    try {
      await armMaintenanceToken()
      setMaintenanceOpen(false)
      setMaintenanceConfirmation("")
      setMaintenanceAcknowledged(false)
      toast.success(t("settings.toast.maintenanceArmed"))
    } catch {
      setError("settings.error.maintenanceFailed")
    } finally {
      setWorking(false)
    }
  }

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6" aria-busy={working}>
      <h2 className="text-[1.375rem] font-bold tracking-tight">
        {t("settings.title")}
      </h2>

      {(error || preferencesError || pwa.error) && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>{t("common.operationFailed")}</AlertTitle>
          <AlertDescription>
            {t(error ?? preferencesError ?? pwa.error ?? "settings.error.saveFailed")}
          </AlertDescription>
        </Alert>
      )}

      <SettingsCard title={t("settings.card.display")}>
        <SettingField label={t("language.field")} htmlFor="language-select">
          <Select
            value={language}
            onValueChange={(value) => setLanguage(value === "ja" ? "ja" : "en")}
          >
            <SelectTrigger id="language-select" className="h-11 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{t("language.en")}</SelectItem>
              <SelectItem value="ja">{t("language.ja")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingField>
        <SettingField label={t("settings.field.theme")} htmlFor="theme-select">
          <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            <SelectTrigger id="theme-select" className="h-11 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
              <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
              <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingField>
      </SettingsCard>

      <SettingsCard title={t("settings.card.defaults")}>
        <SettingField
          label={t("settings.field.defaultAlgorithm")}
          htmlFor="default-algorithm"
        >
          <Select
            value={preferences.defaultAlgorithm}
            disabled={preferencesLoading}
            onValueChange={(value) =>
              void savePreference({ defaultAlgorithm: value as UiAlgorithm })
            }
          >
            <SelectTrigger id="default-algorithm" className="h-11 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A256GCM">{t("algorithm.A256GCM")}</SelectItem>
              {env.enableMlKem && !preferences.requireSignature && (
                <SelectItem value="MLKEM1024_A256GCM">
                  {t("algorithm.MLKEM1024_A256GCM")}
                </SelectItem>
              )}
              {env.enableMlKem && env.enableMlDsa && (
                <SelectItem value="MLKEM1024_MLDSA87_A256GCM">
                  {t("algorithm.MLKEM1024_MLDSA87_A256GCM")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </SettingField>
        <SettingField label={t("settings.field.defaultEc")} htmlFor="default-ec">
          <Select
            value={preferences.qrErrorCorrection}
            disabled={preferencesLoading}
            onValueChange={(value) =>
              void savePreference({ qrErrorCorrection: value as QrEcLevel })
            }
          >
            <SelectTrigger id="default-ec" className="h-11 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["L", "M", "Q", "H"] as const).map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("settings.ec.hint")}
          </p>
        </SettingField>
      </SettingsCard>

      <SettingsCard title={t("settings.card.pqMessage")}>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="require-signature">
              {t("settings.requireSignature.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {env.requireSignature
                ? t("settings.requireSignature.forced")
                : t("settings.requireSignature.hint")}
            </p>
          </div>
          <Switch
            id="require-signature"
            aria-label={t("settings.requireSignature.label")}
            checked={preferences.requireSignature}
            disabled={env.requireSignature || preferencesLoading}
            onCheckedChange={(checked) =>
              void savePreference({
                requireSignature: checked,
                ...(checked && preferences.defaultAlgorithm === "MLKEM1024_A256GCM"
                  ? { defaultAlgorithm: "MLKEM1024_MLDSA87_A256GCM" }
                  : {}),
              })
            }
          />
        </div>
        <SettingField
          label={t("settings.field.frameBytes", {
            min: FRAME_BYTES_MIN,
            max: FRAME_BYTES_MAX,
          })}
          htmlFor="frame-bytes"
        >
          <Input
            id="frame-bytes"
            type="number"
            min={FRAME_BYTES_MIN}
            max={FRAME_BYTES_MAX}
            value={preferences.frameBytes}
            onChange={(event) =>
              saveIntegerPreference(
                "frameBytes",
                event.target.value,
                FRAME_BYTES_MIN,
                FRAME_BYTES_MAX,
              )
            }
          />
        </SettingField>
        <SettingField
          label={t("settings.field.frameInterval", {
            min: FRAME_INTERVAL_MS_MIN,
            max: FRAME_INTERVAL_MS_MAX,
          })}
          htmlFor="frame-interval"
        >
          <Input
            id="frame-interval"
            type="number"
            min={FRAME_INTERVAL_MS_MIN}
            max={FRAME_INTERVAL_MS_MAX}
            step={FRAME_INTERVAL_MS_STEP}
            value={preferences.frameIntervalMs}
            onChange={(event) =>
              saveIntegerPreference(
                "frameIntervalMs",
                event.target.value,
                FRAME_INTERVAL_MS_MIN,
                FRAME_INTERVAL_MS_MAX,
                isFrameIntervalMs,
              )
            }
          />
        </SettingField>
        <SettingField
          label={t("settings.field.transferTimeout", {
            min: TRANSFER_TIMEOUT_MINUTES_MIN,
            max: TRANSFER_TIMEOUT_MINUTES_MAX,
          })}
          htmlFor="transfer-timeout"
        >
          <Input
            id="transfer-timeout"
            type="number"
            min={TRANSFER_TIMEOUT_MINUTES_MIN}
            max={TRANSFER_TIMEOUT_MINUTES_MAX}
            value={preferences.transferTimeoutMinutes}
            onChange={(event) =>
              saveIntegerPreference(
                "transferTimeoutMinutes",
                event.target.value,
                TRANSFER_TIMEOUT_MINUTES_MIN,
                TRANSFER_TIMEOUT_MINUTES_MAX,
              )
            }
          />
        </SettingField>
        <p className="text-xs text-muted-foreground">{t("settings.frameEc.hint")}</p>
      </SettingsCard>

      <SettingsCard title={t("settings.card.plaintext")}>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor="clear-after-encrypt" className="leading-relaxed">
            {t("settings.autoClearAfterEncrypt.label")}
          </Label>
          <Switch
            id="clear-after-encrypt"
            checked={preferences.autoClearPlaintextAfterEncrypt}
            onCheckedChange={(checked) =>
              void savePreference({ autoClearPlaintextAfterEncrypt: checked })
            }
            aria-label={t("settings.autoClearAfterEncrypt.label")}
          />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="background-clear" className="leading-relaxed">
              {t("settings.backgroundClear.label")}
            </Label>
            <p
              id="background-clear-description"
              className="text-xs leading-relaxed text-muted-foreground"
            >
              {t("settings.backgroundClear.desc")}
            </p>
          </div>
          <Switch
            id="background-clear"
            checked={preferences.backgroundClearEnabled}
            onCheckedChange={(checked) =>
              void savePreference({ backgroundClearEnabled: checked })
            }
            aria-label={t("settings.backgroundClear.label")}
            aria-describedby="background-clear-description"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="h-11 w-full cursor-pointer focus-visible:ring-2"
          onClick={clearTransientData}
        >
          <Eraser aria-hidden="true" />
          {t("settings.clearAllPlaintext")}
        </Button>
      </SettingsCard>

      <SettingsCard title={t("settings.card.onlineProtection")}>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="wipe-on-online">
              {t("settings.wipeOnOnline.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.wipeOnOnline.hint")}
            </p>
          </div>
          <Switch
            id="wipe-on-online"
            aria-label={t("settings.wipeOnOnline.label")}
            checked={preferences.wipeOnOnline}
            onCheckedChange={(checked) => void savePreference({ wipeOnOnline: checked })}
          />
        </div>
        {!preferences.wipeOnOnline && (
          <Alert variant="destructive" role="alert">
            <TriangleAlert aria-hidden="true" className="size-4" />
            <AlertTitle>{t("settings.wipeOnOnline.offTitle")}</AlertTitle>
            <AlertDescription>{t("settings.wipeOnOnline.offBody")}</AlertDescription>
          </Alert>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={navigatorOnline}
          onClick={() => {
            setMaintenanceConfirmation("")
            setMaintenanceAcknowledged(false)
            setMaintenanceOpen(true)
          }}
        >
          {t("settings.maintenance.button")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("settings.maintenance.hint")}
        </p>
        {navigatorOnline && (
          <p className="text-xs text-destructive">
            {t("settings.maintenance.onlineDisabled")}
          </p>
        )}
      </SettingsCard>

      <Card>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CardHeader className="p-4 pb-3">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full justify-between px-0"
              >
                {t("settings.advanced.title")}
                <ChevronDown
                  aria-hidden="true"
                  className={advancedOpen ? "rotate-180" : ""}
                />
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-3 p-4 pt-0">
              <SettingField
                label={t("settings.advanced.field", {
                  min: RESET_CHURN_MB_MIN,
                  max: RESET_CHURN_MB_MAX,
                })}
                htmlFor="reset-churn"
              >
                <Input
                  id="reset-churn"
                  type="number"
                  min={RESET_CHURN_MB_MIN}
                  max={RESET_CHURN_MB_MAX}
                  value={preferences.resetChurnMb}
                  onChange={(event) =>
                    saveIntegerPreference(
                      "resetChurnMb",
                      event.target.value,
                      RESET_CHURN_MB_MIN,
                      RESET_CHURN_MB_MAX,
                    )
                  }
                />
              </SettingField>
              <Alert variant="destructive">
                <AlertDescription>
                  {t("settings.resetChurn.warning")}
                </AlertDescription>
              </Alert>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <Card className="border-destructive/60">
        <CardHeader className="p-4 pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <TriangleAlert aria-hidden="true" className="size-5" />
            {t("settings.dataDeletion.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <Button
            type="button"
            variant="destructive"
            className="h-11 w-full cursor-pointer justify-start focus-visible:ring-2"
            onClick={() => {
              setTypedAction("keys")
              setDeleteConfirmation("")
            }}
          >
            <Trash2 aria-hidden="true" />
            {t("settings.deleteAllKeys")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 w-full cursor-pointer justify-start focus-visible:ring-2"
            onClick={() => {
              setTypedAction("reset")
              setDeleteConfirmation("")
            }}
          >
            <Database aria-hidden="true" />
            {t("settings.resetAllData")}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("settings.dataDeletion.note")}
          </p>
        </CardContent>
      </Card>

      <SettingsCard title={t("settings.card.pwaInfo")}>
        <InfoRow
          label={t("pwa.installState.label")}
          value={
            standalone
              ? t("pwa.installState.installed")
              : t("settings.pwa.browserView")
          }
        />
        <InfoRow
          label={t("pwa.offlineReady.label")}
          value={
            pwa.offlineReady
              ? t("pwa.offlineReady.ready")
              : t("pwa.offlineReady.preparing")
          }
        />
        {!features.serviceWorker && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" className="size-4" />
            <AlertDescription>{t("settings.sw.unavailable")}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.pwa.noUpdatePolicy")}
        </p>
        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
          <InfoRow label={t("settings.info.version")} value={__APP_VERSION__} mono />
          <InfoRow label={t("settings.info.build")} value={env.buildSha.slice(0, 7)} mono />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.pwa.offlineReadyNote")}
        </p>
      </SettingsCard>

      <SettingsCard title={t("settings.card.featureDetect")}>
        <FeatureRow label="Web Crypto" supported={features.webCrypto} />
        <FeatureRow label="IndexedDB" supported={features.indexedDb} />
        <FeatureRow label={t("feature.camera")} supported={features.camera} />
        <FeatureRow label="Service Worker" supported={features.serviceWorker} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.featureDetect.note")}
        </p>
      </SettingsCard>

      <Card>
        <Collapsible open={securityOpen} onOpenChange={setSecurityOpen}>
          <CardHeader className="p-4 pb-3">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full cursor-pointer justify-between px-0 text-base font-semibold focus-visible:ring-2"
              >
                <span className="flex items-center gap-2">
                  <ShieldAlert aria-hidden="true" className="size-5" />
                  {t("settings.security.title")}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={
                    securityOpen
                      ? "rotate-180 transition-transform"
                      : "transition-transform"
                  }
                />
              </Button>
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4 p-4 pt-0 text-sm leading-relaxed">
              <p className="font-medium">
                {t("settings.security.scope")}
              </p>
              <div>
                <p className="font-medium">
                  {t("settings.security.outOfScope.heading")}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>{t("settings.security.outOfScope.1")}</li>
                  <li>{t("settings.security.outOfScope.2")}</li>
                  <li>{t("settings.security.outOfScope.3")}</li>
                  <li>{t("settings.security.outOfScope.4")}</li>
                  <li>{t("settings.security.outOfScope.5")}</li>
                  <li>{t("settings.security.outOfScope.6")}</li>
                  <li>{t("settings.security.outOfScope.7")}</li>
                </ul>
              </div>
              <p>{t("settings.security.offlineDisplayNote")}</p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>{t("settings.security.caveat.1")}</li>
                <li>{t("settings.security.caveat.2")}</li>
                <li>{t("settings.security.caveat.3")}</li>
                <li>{t("settings.security.caveat.4")}</li>
              </ul>
              <p>{t("settings.security.wipeOnOnlineNote")}</p>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <AlertDialog
        open={maintenanceOpen}
        onOpenChange={(open) => {
          if (!open) {
            setMaintenanceOpen(false)
            setMaintenanceConfirmation("")
            setMaintenanceAcknowledged(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.maintenance.button")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.maintenance.dialogDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="maintenance-confirmation">
                {t("settings.confirmationLabel")}
              </Label>
              <Input
                id="maintenance-confirmation"
                value={maintenanceConfirmation}
                onChange={(event) => setMaintenanceConfirmation(event.target.value)}
                autoComplete="off"
                placeholder={KEEP_KEYS_CONFIRMATION}
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="maintenance-ack"
                checked={maintenanceAcknowledged}
                onCheckedChange={(checked) =>
                  setMaintenanceAcknowledged(checked === true)
                }
              />
              <Label htmlFor="maintenance-ack">
                {t("settings.maintenance.ackLabel")}
              </Label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                working ||
                navigatorOnline ||
                maintenanceConfirmation !== KEEP_KEYS_CONFIRMATION ||
                !maintenanceAcknowledged
              }
              onClick={() => void armMaintenance()}
            >
              {t("settings.maintenance.armButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={typedAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTypedAction(null)
            setDeleteConfirmation("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {typedAction === "keys"
                ? t("settings.deleteAllKeys")
                : t("settings.resetAllData")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {typedAction === "keys"
                ? t("settings.delete.desc.keys")
                : t("settings.delete.desc.reset")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirmation">{t("settings.confirmationLabel")}</Label>
            <Input
              id="delete-confirmation"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="h-11 text-base focus-visible:ring-2"
              autoComplete="off"
              placeholder={DELETE_ALL_CONFIRMATION}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteConfirmation !== DELETE_ALL_CONFIRMATION || working}
              onClick={() => void performTypedDelete()}
            >
              {working ? t("settings.delete.working") : t("settings.delete.execute")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">{children}</CardContent>
    </Card>
  )
}

function SettingField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : "font-medium"}>{value}</span>
    </div>
  )
}

function FeatureRow({ label, supported }: { label: string; supported: boolean }) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm">
      {supported ? (
        <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
      ) : (
        <XCircle aria-hidden="true" className="size-4 text-destructive" />
      )}
      <span>{label}</span>
      <span className="ml-auto text-muted-foreground">
        {supported
          ? t("common.supported.yes")
          : t("common.featureUnavailable", { feature: label })}
      </span>
    </div>
  )
}
