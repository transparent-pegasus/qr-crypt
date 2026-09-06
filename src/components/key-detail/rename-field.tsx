import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useI18n } from "@/i18n"

export function RenameField({
  value,
  busy,
  onChange,
  onSubmit,
}: {
  value: string
  busy: boolean
  onChange: (value: string) => void
  onSubmit: () => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-2">
      <Label htmlFor="key-rename">{t("keyDetail.rename.label")}</Label>
      <div className="flex gap-2">
        <Input
          id="key-rename"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={80}
          className="h-11"
          disabled={busy}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0"
          disabled={busy || value.trim().length === 0}
          onClick={() => void onSubmit()}
        >
          {t("keyDetail.rename.submit")}
        </Button>
      </div>
    </div>
  )
}
