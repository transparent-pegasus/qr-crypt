import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import { RefreshCw, ShieldAlert } from "lucide-react"
import type { RegisterSWOptions } from "virtual:pwa-register/react"
import { toast } from "sonner"
import { useSensitiveSession } from "@/app/providers"
import { useDefaultRegisterSW } from "@/hooks/use-register-sw"
import { Button } from "@/components/ui/button"
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

export interface RegisterSwResult {
  needRefresh: [boolean, Dispatch<SetStateAction<boolean>>]
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>]
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>
}

export type UseRegisterSwHook = (options?: RegisterSWOptions) => RegisterSwResult

interface PwaUpdateContextValue {
  needRefresh: boolean
  offlineReady: boolean
  checking: boolean
  error: string | null
  checkForUpdate: () => Promise<void>
}

const PwaUpdateContext = createContext<PwaUpdateContextValue | null>(null)

export function usePwaUpdate(): PwaUpdateContextValue {
  const value = useContext(PwaUpdateContext)
  if (!value) throw new Error("usePwaUpdate must be used inside PwaUpdatePrompt")
  return value
}

export function PwaUpdatePrompt({
  children,
  registerHook,
}: {
  children: ReactNode
  registerHook: UseRegisterSwHook | undefined
}) {
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const sensitive = useSensitiveSession()

  const registrationOptions = useMemo<RegisterSWOptions>(
    () => ({
      onRegisterError: () => {
        setError("Service Workerを登録できませんでした。")
      },
    }),
    [],
  )
  const useRegistration = registerHook ?? useDefaultRegisterSW
  const registration = useRegistration(registrationOptions)
  const [needRefresh] = registration.needRefresh
  const [offlineReady] = registration.offlineReady

  useEffect(() => {
    if (!offlineReady) return
    toast.success("オフライン利用の準備ができました")
  }, [offlineReady])

  const checkForUpdate = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const registrationFromBrowser =
        "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistration()
          : undefined
      if (!registrationFromBrowser) {
        setError("Service Workerを利用できないため更新を確認できません。")
        return
      }
      await registrationFromBrowser.update()
      toast.info("更新を確認しました")
    } catch {
      setError("更新を確認できませんでした。時間をおいて再試行してください。")
    } finally {
      setChecking(false)
    }
  }, [])

  const blockedReason = sensitive.cryptoBusy
    ? "暗号処理中は更新できません。処理が終わるまでお待ちください。"
    : sensitive.secretVisible
      ? "秘密情報の表示中は更新できません。表示を閉じてください。"
      : null
  const needsSensitiveConfirmation = sensitive.hasPlaintext || sensitive.hasDecrypted

  const applyUpdate = () => {
    void registration.updateServiceWorker(true)
  }

  const requestUpdate = () => {
    if (blockedReason) return
    if (needsSensitiveConfirmation) {
      setConfirmOpen(true)
    } else {
      applyUpdate()
    }
  }

  const contextValue = useMemo(
    () => ({
      needRefresh,
      offlineReady,
      checking,
      error,
      checkForUpdate,
    }),
    [checkForUpdate, checking, error, needRefresh, offlineReady],
  )

  return (
    <PwaUpdateContext.Provider value={contextValue}>
      {children}
      {needRefresh && (
        <aside
          aria-label="アプリ更新通知"
          className="fixed inset-x-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-xl border bg-background p-4 shadow-lg"
        >
          <div className="flex items-start gap-3">
            <RefreshCw aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-semibold">新しいバージョンがあります</p>
              <p className="text-sm text-muted-foreground">
                更新はボタンを押すまで適用されません。
              </p>
              {blockedReason && (
                <p role="status" className="flex gap-2 text-sm text-destructive">
                  <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {blockedReason}
                </p>
              )}
              <Button
                type="button"
                className="h-11 w-full cursor-pointer focus-visible:ring-2"
                disabled={blockedReason !== null}
                onClick={requestUpdate}
              >
                更新する
              </Button>
            </div>
          </div>
        </aside>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>更新してもよろしいですか</AlertDialogTitle>
            <AlertDialogDescription>
              入力中の平文は消去されます。必要な内容を別の安全な方法で確認してから更新してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={applyUpdate}>更新する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PwaUpdateContext.Provider>
  )
}
