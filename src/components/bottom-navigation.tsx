import { Archive, KeyRound, Lock, Settings } from "lucide-react"
import { NavLink, useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"

const ITEMS = [
  { to: "/encrypt", label: "暗号化", icon: Lock },
  { to: "/keys", label: "鍵", icon: KeyRound },
  { to: "/saved", label: "保存済み", icon: Archive },
  { to: "/settings", label: "設定", icon: Settings },
] as const

export function BottomNavigation() {
  const navigate = useNavigate()
  return (
    <nav
      aria-label="メインナビゲーション"
      className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 pb-safe backdrop-blur"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-4">
        {ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onKeyDown={(event) => {
                if (event.key === " ") {
                  event.preventDefault()
                  navigate(item.to)
                }
              }}
              className={({ isActive }) =>
                cn(
                  "relative flex min-h-11 min-w-11 cursor-pointer flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive &&
                    "text-primary before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:bg-primary",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon aria-hidden="true" className="size-5" />
                  <span>{item.label}</span>
                  {isActive && <span className="sr-only">現在のページ</span>}
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
