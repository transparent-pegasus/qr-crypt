import { Wifi, WifiOff } from "lucide-react"
import { useDisplayGate } from "@/app/display-gate"
import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/i18n"

export function NetworkStatusBadge() {
  const { t } = useI18n()
  const { online } = useDisplayGate()
  const Icon = online ? Wifi : WifiOff
  return (
    <Badge
      variant="outline"
      aria-live="polite"
      className="gap-1.5 whitespace-nowrap text-muted-foreground"
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span>{online ? t("network.online") : t("network.offline")}</span>
      <span className="sr-only">{t("network.srLabel")}</span>
    </Badge>
  )
}
