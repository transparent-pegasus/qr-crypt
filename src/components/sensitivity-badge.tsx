import { Globe, ShieldAlert, TriangleAlert } from "lucide-react"
import type { Sensitivity } from "@/schemas/domain"
import { Badge } from "@/components/ui/badge"

export function SensitivityBadge({ sensitivity }: { sensitivity: Sensitivity }) {
  if (sensitivity === "public") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Globe aria-hidden="true" className="size-3.5" />
        公開
      </Badge>
    )
  }
  if (sensitivity === "confidential") {
    return (
      <Badge className="gap-1 border-transparent bg-warning text-warning-foreground">
        <ShieldAlert aria-hidden="true" className="size-3.5" />
        機密
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <TriangleAlert aria-hidden="true" className="size-3.5" />
      機密情報
    </Badge>
  )
}
