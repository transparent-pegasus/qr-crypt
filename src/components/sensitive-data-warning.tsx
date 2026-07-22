import { TriangleAlert } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export const SECRET_QR_WARNING =
  "このQRコードには暗号化と復号に使用できる秘密鍵が含まれています。撮影、画面共有、クラウド同期された場合、暗号文を復号される可能性があります。"

export interface SensitiveDataWarningProps {
  strong?: boolean
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  confirmationLabel?: string
}

export function SensitiveDataWarning({
  strong = false,
  checked = false,
  onCheckedChange,
  confirmationLabel = "リスクを理解しました",
}: SensitiveDataWarningProps) {
  return (
    <div className="space-y-3">
      <Alert variant="destructive">
        <TriangleAlert aria-hidden="true" className="size-4" />
        <AlertTitle>機密情報です</AlertTitle>
        <AlertDescription>{SECRET_QR_WARNING}</AlertDescription>
      </Alert>
      {strong && (
        <div className="flex min-h-11 items-center gap-3 rounded-md border p-3">
          <Checkbox
            id="sensitive-risk-confirmation"
            checked={checked}
            onCheckedChange={(value) => onCheckedChange?.(value === true)}
            className="size-5"
          />
          <Label
            htmlFor="sensitive-risk-confirmation"
            className="cursor-pointer leading-relaxed"
          >
            {confirmationLabel}
          </Label>
        </div>
      )}
    </div>
  )
}
