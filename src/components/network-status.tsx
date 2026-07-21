import { Wifi, WifiOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useOnlineStatus } from "@/hooks/use-online-status"

export function NetworkStatusBadge() {
  const online = useOnlineStatus()
  const Icon = online ? Wifi : WifiOff
  return (
    <Badge
      variant="outline"
      aria-live="polite"
      className="gap-1.5 whitespace-nowrap text-muted-foreground"
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span>{online ? "オンライン" : "オフライン"}</span>
      <span className="sr-only">（通信状態）</span>
    </Badge>
  )
}
