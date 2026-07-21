import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Database,
  Eraser,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import {
  useFeatureSupport,
  useTheme,
  useTransientClear,
  type Theme,
} from "@/app/providers"
import { usePwaUpdate } from "@/components/pwa-update-prompt"
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
import { deleteEntireDatabase } from "@/storage/database"
import { clearAllKeys } from "@/storage/key-repository"
import { clearAllQrArtifacts, listQrArtifacts } from "@/storage/qr-repository"

type TypedDeleteAction = "keys" | "reset"

const CLEAR_OPTIONS = [
  { value: 60, label: "1分" },
  { value: 300, label: "5分" },
  { value: 900, label: "15分" },
  { value: 0, label: "即時" },
] as const

export function SettingsPage() {
  const features = useFeatureSupport()
  const { theme, setTheme } = useTheme()
  const { clearTransient } = useTransientClear()
  const { keys, refresh: refreshKeys } = useKeys()
  const {
    preferences,
    loading: preferencesLoading,
    error: preferencesError,
    updatePreferences,
  } = usePreferences()
  const pwa = usePwaUpdate()
  const [qrCount, setQrCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [clearQrOpen, setClearQrOpen] = useState(false)
  const [typedAction, setTypedAction] = useState<TypedDeleteAction | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [securityOpen, setSecurityOpen] = useState(true)
  const [working, setWorking] = useState(false)

  const loadQrCount = useCallback(async () => {
    try {
      setQrCount((await listQrArtifacts()).length)
    } catch {
      setError("保存済みQRの件数を取得できませんでした。")
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void loadQrCount())
  }, [loadQrCount])

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

  const clearSavedQr = async () => {
    setWorking(true)
    try {
      await clearAllQrArtifacts()
      setClearQrOpen(false)
      await loadQrCount()
      toast.success("すべての保存QRを消去しました")
    } catch {
      setError("保存済みQRを消去できませんでした。")
    } finally {
      setWorking(false)
    }
  }

  const performTypedDelete = async () => {
    if (!typedAction || deleteConfirmation !== "全削除") return
    setWorking(true)
    try {
      if (typedAction === "keys") {
        await clearAllKeys()
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
        await loadQrCount()
        toast.success("全ローカルデータを初期化しました")
      }
      setTypedAction(null)
      setDeleteConfirmation("")
    } catch {
      setError("データを消去できませんでした。保存領域を確認してください。")
    } finally {
      setWorking(false)
    }
  }

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const clearValues = CLEAR_OPTIONS.some(
    (option) => option.value === preferences.backgroundClearSeconds,
  )
    ? CLEAR_OPTIONS
    : [
        ...CLEAR_OPTIONS,
        {
          value: preferences.backgroundClearSeconds,
          label: `${preferences.backgroundClearSeconds}秒`,
        },
      ]

  return (
    <section className="mx-auto w-full max-w-md space-y-6 px-4 py-6">
      <h2 className="text-[1.375rem] font-bold tracking-tight">設定</h2>

      {(error || preferencesError || pwa.error) && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />
          <AlertTitle>操作を完了できません</AlertTitle>
          <AlertDescription>{error ?? preferencesError ?? pwa.error}</AlertDescription>
        </Alert>
      )}

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
              {env.enableRsa && (
                <SelectItem value="RSA-HYBRID">
                  {ALGORITHM_LABELS["RSA-HYBRID"]}
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
        <SettingField
          label="バックグラウンド移行後の自動消去時間"
          htmlFor="background-clear"
        >
          <Select
            value={String(preferences.backgroundClearSeconds)}
            onValueChange={(value) =>
              void savePreference({ backgroundClearSeconds: Number(value) })
            }
          >
            <SelectTrigger id="background-clear" className="h-11 text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {clearValues.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingField>
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

      <SettingsCard title="アプリ情報 (PWA)">
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
              この機能は利用できません: Service
              Worker。オフライン起動と更新通知を利用できません。
            </AlertDescription>
          </Alert>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full cursor-pointer focus-visible:ring-2"
          disabled={!features.serviceWorker || pwa.checking}
          onClick={() => void pwa.checkForUpdate()}
        >
          {pwa.checking ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          {pwa.checking ? "確認中…" : "更新を確認"}
        </Button>
        {pwa.needRefresh && (
          <p className="flex gap-2 text-sm text-muted-foreground" role="status">
            <RefreshCw aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            新しいバージョンがあります。画面の更新通知から「更新する」を選んでください。
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
          <InfoRow label="バージョン" value={__APP_VERSION__} mono />
          <InfoRow label="ビルド" value={env.buildSha.slice(0, 7)} mono />
          <InfoRow label="保存鍵" value={`${keys.length} 件`} mono />
          <InfoRow label="保存QR" value={`${qrCount} 件`} mono />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          オフライン利用準備状態は資産の保存状態を示します。安全性を示すものではありません。
        </p>
      </SettingsCard>

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
            variant="outline"
            className="h-11 w-full cursor-pointer justify-start border-destructive/50 text-destructive focus-visible:ring-2"
            onClick={() => setClearQrOpen(true)}
          >
            <Trash2 aria-hidden="true" />
            すべての保存QRを消去
          </Button>
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
                  <li>PWA初回取得時・更新時の供給網侵害</li>
                  <li>端末の物理的な窃取</li>
                  <li>ユーザー自身による秘密QRの誤共有</li>
                  <li>ブラウザーデータ削除による鍵の消失</li>
                </ul>
              </div>
              <p>
                オフライン表示は現在のネットワーク状態を示す補助情報であり、安全性の証明ではありません。
              </p>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

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

      <AlertDialog open={clearQrOpen} onOpenChange={setClearQrOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>すべての保存QRを消去しますか</AlertDialogTitle>
            <AlertDialogDescription>
              アプリ内に保存したQRをすべて削除します。鍵本体は削除しません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={working}
              onClick={() => void clearSavedQr()}
            >
              消去する
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
              {working ? "消去中…" : "完全に消去する"}
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
