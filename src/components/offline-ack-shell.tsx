import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

export interface OfflineAckShellProps {
  generation: number
  onContinue: (generation: number) => boolean
  variant?: "standard" | "wiped"
}

export function OfflineAckShell({
  generation,
  onContinue,
  variant = "standard",
}: OfflineAckShellProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const checkboxId = `offline-risk-ack-${generation}`
  const wiped = variant === "wiped"

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const continueOffline = () => {
    if (!checked || submitting) return
    setSubmitting(true)
    if (!onContinue(generation)) {
      setChecked(false)
      setSubmitting(false)
    }
  }

  return (
    <main
      aria-labelledby="offline-ack-title"
      className="fixed inset-0 max-h-dvh overflow-y-auto bg-background text-foreground [padding-block-end:max(1rem,env(safe-area-inset-bottom))] [padding-block-start:max(1rem,env(safe-area-inset-top))] [padding-inline-end:max(1rem,env(safe-area-inset-right))] [padding-inline-start:max(1rem,env(safe-area-inset-left))]"
    >
      <section className="mx-auto w-full max-w-2xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        {wiped && (
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-success"
              />
              <div className="space-y-1">
                <h2 className="font-semibold">
                  オンラインを検出したため、ローカルデータを初期化しました
                </h2>
                <p className="text-sm text-muted-foreground">
                  論理削除を試行しました。物理消去は保証されません。
                </p>
              </div>
            </div>
          </div>
        )}

        <header className="flex items-start gap-3">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-6 shrink-0 text-warning"
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              オフラインへ切り替わりました
            </p>
            <h1
              id="offline-ack-title"
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-2xl"
            >
              続行前の確認
            </h1>
          </div>
        </header>

        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          <p>
            このアプリは「オンラインに接続した端末は常に侵害されうる」という前提で設計されています。オンライン状態から機内モードやネットワーク切断を選んでも、それによって端末が信頼できる状態に戻るわけではありません。オンライン中に侵害されたコード・鍵・データは、オフライン化後もそのまま残り得ます。
          </p>
          <p>
            {"リスクを抑えるには、ネットワークから物理的に遮断し、"}
            <strong className="font-semibold text-foreground">二度と接続しない</strong>
            {
              "専用端末として運用する必要があります。それ以外に、完全に安全にメッセージの暗号化を行う方法はありません。"
            }
            <strong className="font-semibold text-foreground">
              {
                "それでも、端末や導入済みコードを含めた完全な安全を本アプリが保証するものではありません。"
              }
            </strong>
          </p>
        </div>

        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex min-h-11 items-start gap-3">
            <Checkbox
              id={checkboxId}
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
              className="mt-0.5 size-5"
            />
            <label
              htmlFor={checkboxId}
              className="cursor-pointer text-sm leading-relaxed"
            >
              上記を理解した上で、リスクを受け入れてこの端末で続行します
            </label>
          </div>
          <p className="pl-8 text-xs leading-relaxed text-muted-foreground">
            このチェックは端末の安全性を検証・回復するものではありません
          </p>
        </div>

        <Button
          type="button"
          className="h-11 w-full whitespace-normal"
          disabled={!checked || submitting}
          onClick={continueOffline}
        >
          {wiped ? "再読み込みして続行" : "リスクを理解してオフライン機能を表示"}
        </Button>
      </section>
    </main>
  )
}
