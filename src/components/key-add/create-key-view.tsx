import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useI18n } from "@/i18n"
import { cn } from "@/lib/utils"

export type CreateKeyType = "pq-identity" | "symmetric"

export function CreateKeyView({
  kind,
  onKindChange,
  value,
  onChange,
  busy,
  onCreate,
}: {
  kind: CreateKeyType
  onKindChange: (kind: CreateKeyType) => void
  value: string
  onChange: (value: string) => void
  busy: boolean
  onCreate: () => void
}) {
  const { t } = useI18n()
  const pq = kind === "pq-identity"
  const nameLabel = t(pq ? "keys.create.nameLabel.pq" : "keys.create.nameLabel.symmetric")
  const buttonLabel = t(pq ? "keys.create.button.pq" : "keys.create.button.symmetric")
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="space-y-2">
          <Label htmlFor="create-key-kind">{t("keys.create.kindLabel")}</Label>
          <Select
            value={kind}
            onValueChange={(value) => onKindChange(value as CreateKeyType)}
          >
            <SelectTrigger id="create-key-kind" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pq-identity">
                {t("keys.create.kind.pqIdentity")}
              </SelectItem>
              <SelectItem value="symmetric">
                {t("algorithm.A256GCM")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Label htmlFor="create-key-name">{nameLabel}</Label>
        <Input
          id="create-key-name"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={80}
        />
        {kind === "pq-identity" && (
          <div
            role="note"
            className={cn(
              buttonVariants({ variant: "outline" }),
              // buttonVariants carries whitespace-nowrap, which pushed this note
              // past the modal's content box on a narrow screen.
              "min-h-11 w-full cursor-default select-text touch-auto whitespace-normal py-2 text-center text-muted-foreground hover:bg-background hover:text-muted-foreground",
            )}
          >
            <ShieldCheck aria-hidden="true" />
            {t("keys.create.experimentalNote")}
          </div>
        )}
        <Button
          type="button"
          className="h-11 w-full"
          disabled={busy || !value.trim()}
          onClick={onCreate}
        >
          {busy ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <KeyRound aria-hidden="true" />
          )}
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  )
}
