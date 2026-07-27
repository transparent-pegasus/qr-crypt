import type { ReactNode } from "react"
import { KeyRound, LockKeyhole, LockKeyholeOpen, Settings } from "lucide-react"
import { NavLink, useNavigate } from "react-router"
import { useI18n, type MessageKey } from "@/i18n"
import { cn } from "@/lib/utils"

export const NAV_ITEM_CLASS =
  "relative flex min-h-11 min-w-11 cursor-pointer flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
export const NAV_ITEM_ACTIVE_CLASS =
  "text-primary before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:bg-primary"

export function BottomNavigationShell({
  ariaLabel,
  children,
}: {
  ariaLabel: string
  children: ReactNode
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 pb-safe backdrop-blur"
    >
      <div className="mx-auto grid h-16 max-w-md auto-cols-fr grid-flow-col">
        {children}
      </div>
    </nav>
  )
}

const ITEMS: ReadonlyArray<{
  to: string
  labelKey: MessageKey
  icon: typeof LockKeyhole
}> = [
  { to: "/encrypt", labelKey: "nav.encrypt", icon: LockKeyhole },
  { to: "/decrypt", labelKey: "nav.decrypt", icon: LockKeyholeOpen },
  { to: "/keys", labelKey: "nav.keys", icon: KeyRound },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
] as const

export function BottomNavigation() {
  const { t } = useI18n()
  const navigate = useNavigate()
  return (
    <BottomNavigationShell ariaLabel={t("nav.ariaLabel")}>
      {ITEMS.map((item) => {
        const Icon = item.icon
        const label = t(item.labelKey)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            aria-label={label}
            onKeyDown={(event) => {
              if (event.key === " ") {
                event.preventDefault()
                navigate(item.to)
              }
            }}
            className={({ isActive }) =>
              cn(NAV_ITEM_CLASS, isActive && NAV_ITEM_ACTIVE_CLASS)
            }
          >
            <Icon aria-hidden="true" className="size-6" />
          </NavLink>
        )
      })}
    </BottomNavigationShell>
  )
}
