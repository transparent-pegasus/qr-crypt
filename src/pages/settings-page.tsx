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
import { ALGORITHM_LABELS } from "@/features/presentation"
import { useKeys } from "@/hooks/use-keys"
import { usePreferences } from "@/hooks/use-preferences"
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
  const [error, setError] = useState<string | null>(null)
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
      toast.success("設定を保存しました")
    } catch {
      setError("設定を保存できませんでした。保存領域を確認してください。")
    }
  }

  const clearTransientData = () => {
    clearTransient()
    toast.success("すべての平文を消去しました")
  }

  const performTypedDelete = async () => {
    if (!typedAction || deleteConfirmation !== "全削除") return
    setWorking(true)
    try {
      if (typedAction === "keys") {
        await Promise.all([clearAllKeys(), clearAllIdentities()])
        await refreshKeys()
        toast.success("すべての鍵を消去しました")
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
        toast.success("論理削除を試行しました。物理消去は保証されません。")
      }
      setTypedAction(null)
      setDeleteConfirmation("")
    } catch {
      setError("データを消去できませんでした。保存領域を確認してください。")
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
      maintenanceConfirmation !== "鍵を保持して更新" ||
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
      toast.success("次の一回だけ鍵を保持する設定を arm しました")
    } catch {
      setError(
        "maintenance tokenを設定できませんでした。オフライン状態を確認してください。",
      )
    } finally {
      setWorking(false)
    }
  }

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6" aria-busy={working}>
      <h2 className="text-[1.375rem] font-bold tracking-tight">設定</h2>

      {(error || preferencesError || pwa.error) && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>操作を完了できません</AlertTitle>
          <AlertDescription>{error ?? preferencesError ?? pwa.error}</AlertDescription>
        </Alert>
      )}

      <SettingsCard title="表示">
        <SettingField label="テーマ" htmlFor="theme-select">
          <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            <SelectTrigger id="theme-select" className="h-11 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">システム</SelectItem>
              <SelectItem value="light">ライト</SelectItem>
              <SelectItem value="dark">ダーク</SelectItem>
            </SelectContent>
          </Select>
        </SettingField>
      </SettingsCard>

      <SettingsCard title="既定値">
        <SettingField label="デフォルト暗号方式" htmlFor="default-algorithm">
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
              <SelectItem value="A256GCM">{ALGORITHM_LABELS.A256GCM}</SelectItem>
              {env.enableMlKem && !preferences.requireSignature && (
                <SelectItem value="MLKEM1024_A256GCM">
                  {ALGORITHM_LABELS.MLKEM1024_A256GCM}
                </SelectItem>
              )}
              {env.enableMlKem && env.enableMlDsa && (
                <SelectItem value="MLKEM1024_MLDSA87_A256GCM">
                  {ALGORITHM_LABELS.MLKEM1024_MLDSA87_A256GCM}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </SettingField>
        <SettingField label="デフォルトQR誤り訂正レベル" htmlFor="default-ec">
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
            高いほど読み取りに強く、入る量は減ります。鍵QRは設定にかかわらず常にHです。
          </p>
        </SettingField>
      </SettingsCard>

      <SettingsCard title="ポスト量子メッセージ">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="require-signature">署名を必須にする</Label>
            <p className="text-xs text-muted-foreground">
              {env.requireSignature
                ? "環境設定で必須化されているため解除できません。"
                : "有効時は非署名のポスト量子方式を選択肢から隠します。"}
            </p>
          </div>
          <Switch
            id="require-signature"
            aria-label="署名を必須にする"
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
          label={`1フレームの生データ ${FRAME_BYTES_MIN}〜${FRAME_BYTES_MAX} bytes`}
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
          label={`フレーム切替間隔 ${FRAME_INTERVAL_MS_MIN}〜${FRAME_INTERVAL_MS_MAX} ms`}
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
          label={`読取状態の期限 ${TRANSFER_TIMEOUT_MINUTES_MIN}〜${TRANSFER_TIMEOUT_MINUTES_MAX} 分`}
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
        <p className="text-xs text-muted-foreground">
          OCF2フレームの誤り訂正は常にQです。
        </p>
      </SettingsCard>

      <SettingsCard title="平文の扱い">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor="clear-after-encrypt" className="leading-relaxed">
            暗号化後に平文を自動消去
          </Label>
          <Switch
            id="clear-after-encrypt"
            checked={preferences.autoClearPlaintextAfterEncrypt}
            onCheckedChange={(checked) =>
              void savePreference({ autoClearPlaintextAfterEncrypt: checked })
            }
            aria-label="暗号化後に平文を自動消去"
          />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="background-clear" className="leading-relaxed">
              バックグラウンド移行後に自動消去
            </Label>
            <p
              id="background-clear-description"
              className="text-xs leading-relaxed text-muted-foreground"
            >
              有効時はバックグラウンド移行から約5分後に平文を消去します。
            </p>
          </div>
          <Switch
            id="background-clear"
            checked={preferences.backgroundClearEnabled}
            onCheckedChange={(checked) =>
              void savePreference({ backgroundClearEnabled: checked })
            }
            aria-label="バックグラウンド移行後に自動消去"
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
          すべての平文を消去
        </Button>
      </SettingsCard>

      <SettingsCard title="オンライン検出時の保護">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="wipe-on-online">
              オンライン確定時にローカルデータを初期化
            </Label>
            <p className="text-xs text-muted-foreground">
              既定ON。専用sentinelの本文一致後だけ実行します。
            </p>
          </div>
          <Switch
            id="wipe-on-online"
            aria-label="オンライン確定時にローカルデータを初期化"
            checked={preferences.wipeOnOnline}
            onCheckedChange={(checked) => void savePreference({ wipeOnOnline: checked })}
          />
        </div>
        {!preferences.wipeOnOnline && (
          <Alert variant="destructive" role="alert">
            <TriangleAlert aria-hidden="true" className="size-4" />
            <AlertTitle>ローカルデータが残り続けます</AlertTitle>
            <AlertDescription>
              永続OFFでは、接続を検出しても鍵とローカルデータを自動初期化しません。
            </AlertDescription>
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
          次の一回だけ鍵を保持して更新
        </Button>
        <p className="text-xs text-muted-foreground">
          オフライン中だけ arm できます。暗号文保存の救済経路ではなく、次の verified
          transition 後に必ず失効します。
        </p>
        {navigatorOnline && (
          <p className="text-xs text-destructive">オンライン中は設定できません。</p>
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
                Advanced: reset churn
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
                label={`reset churn (${RESET_CHURN_MB_MIN}–${RESET_CHURN_MB_MAX} MB)`}
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
                  既定は0です。churnは消去保証にならず、物理データの回収不能を保証しません。
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
            データの消去
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
            すべての鍵を消去
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
            全ローカルデータ初期化
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            全初期化はIndexedDBの全ストア、oc-*のlocalStorage、メモリー内の一時データを消去します。オフライン起動を維持するためService
            Workerのキャッシュは保持します。
          </p>
        </CardContent>
      </Card>

      <SettingsCard title="PWAアプリ情報">
        <InfoRow
          label="PWAインストール状態"
          value={standalone ? "インストール済み" : "ブラウザー表示中"}
        />
        <InfoRow
          label="オフライン利用準備状態"
          value={pwa.offlineReady ? "準備完了" : "準備中"}
        />
        {!features.serviceWorker && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" className="size-4" />
            <AlertDescription>
              この機能は利用できません: Service Worker。オフライン起動を利用できません。
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">
          アプリの更新は行わない方針です。新しいバージョンの利用には端末の完全フォーマット後の再インストールが必要です。
        </p>
        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
          <InfoRow label="バージョン" value={__APP_VERSION__} mono />
          <InfoRow label="ビルド" value={env.buildSha.slice(0, 7)} mono />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          オフライン利用準備状態は資産の保存状態を示します。安全性を示すものではありません。
        </p>
      </SettingsCard>

      <SettingsCard title="機能検出">
        <FeatureRow label="Web Crypto" supported={features.webCrypto} />
        <FeatureRow label="IndexedDB" supported={features.indexedDb} />
        <FeatureRow label="カメラ" supported={features.camera} />
        <FeatureRow label="Service Worker" supported={features.serviceWorker} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Web
          CryptoまたはIndexedDBが利用できない場合はUNSUPPORTED_BROWSER画面で全機能を停止します。
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
                  セキュリティについて
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
                このアプリが保証するのは、アプリケーションが意図的に平文や秘密鍵を外部送信しないことまでです。
              </p>
              <div>
                <p className="font-medium">防御対象外:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>OS・ブラウザー・ファームウェアの侵害</li>
                  <li>キーロガー・画面録画・スクリーンショット</li>
                  <li>カメラフレームを取得するマルウェア</li>
                  <li>PWA初回取得時・再インストール時の供給網侵害</li>
                  <li>端末の物理的な窃取</li>
                  <li>ユーザー自身による秘密QRの誤共有</li>
                  <li>ブラウザーデータ削除による鍵の消失</li>
                </ul>
              </div>
              <p>
                オフライン表示は現在のネットワーク状態を示す補助情報であり、安全性の証明ではありません。
              </p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>採用している noble の本アプリ統合は独立監査を完了していません。</li>
                <li>JavaScript実装はサイドチャネル耐性を保証しません。</li>
                <li>
                  JavaScriptとGCのため、メモリー上の秘密値を完全消去できる保証はありません。
                </li>
                <li>
                  resetはローカルデータの論理削除を試行します。LevelDB・SSDウェアレベリングを含め、物理消去は保証しません。
                </li>
              </ul>
              <p>
                wipe-on-onlineは、接続後に現在のコードが実行できた場合の残存データ低減です。同一オリジンの悪意あるコード、物理回収、更新前に実行される侵害コードを防ぎません。
              </p>
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
            <AlertDialogTitle>次の一回だけ鍵を保持して更新</AlertDialogTitle>
            <AlertDialogDescription>
              次のオンライン確定時にwipeを一度だけ抑止します。実行するには「鍵を保持して更新」と入力し、注意事項を確認してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="maintenance-confirmation">確認文字列</Label>
              <Input
                id="maintenance-confirmation"
                value={maintenanceConfirmation}
                onChange={(event) => setMaintenanceConfirmation(event.target.value)}
                autoComplete="off"
                placeholder="鍵を保持して更新"
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
                一回限りであり、更新後のコードや端末の安全性を保証しないことを理解しました
              </Label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                working ||
                navigatorOnline ||
                maintenanceConfirmation !== "鍵を保持して更新" ||
                !maintenanceAcknowledged
              }
              onClick={() => void armMaintenance()}
            >
              maintenance tokenをarm
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
              {typedAction === "keys" ? "すべての鍵を消去" : "全ローカルデータ初期化"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {typedAction === "keys"
                ? "すべての暗号文が復号できなくなります。削除を実行するには「全削除」と入力してください。"
                : "IndexedDBとoc-*設定、一時データを消去します。Service Workerキャッシュは保持します。実行するには「全削除」と入力してください。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirmation">確認文字列</Label>
            <Input
              id="delete-confirmation"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="h-11 text-base focus-visible:ring-2"
              autoComplete="off"
              placeholder="全削除"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteConfirmation !== "全削除" || working}
              onClick={() => void performTypedDelete()}
            >
              {working ? "消去中…" : "論理削除を実行"}
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
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm">
      {supported ? (
        <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
      ) : (
        <XCircle aria-hidden="true" className="size-4 text-destructive" />
      )}
      <span>{label}</span>
      <span className="ml-auto text-muted-foreground">
        {supported ? "利用できます" : `この機能は利用できません: ${label}`}
      </span>
    </div>
  )
}
