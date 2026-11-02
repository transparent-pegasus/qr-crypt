import { Navigate, Outlet, createBrowserRouter } from "react-router"
import { MaintenanceTokenProvider } from "@/app/maintenance-token"
import { useMaintenanceToken } from "@/hooks/use-maintenance-token"
import { BottomNavigation } from "@/components/bottom-navigation"
import { NetworkStatusBadge } from "@/components/network-status"
import { DecryptPage } from "@/pages/decrypt-page"
import { EncryptPage } from "@/pages/encrypt-page"
import { KeyListPage } from "@/pages/key-list-page"
import { SettingsPage } from "@/pages/settings-page"
import { useI18n } from "@/i18n"

function AppLayout() {
  const { t } = useI18n()
  const { armed, readFailed } = useMaintenanceToken()
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 pt-safe backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-md items-center justify-between gap-3 px-4">
          <h1 className="truncate text-[1.375rem] font-bold tracking-tight">
            QR Crypt
          </h1>
          <NetworkStatusBadge />
        </div>
        {(armed === true || readFailed) && (
          <div role="status" className="mx-auto max-w-md space-y-2 px-4 pb-4">
            {armed === true && (
              <p className="rounded-lg border border-warning bg-warning/10 p-3 text-sm">
                {t("settings.maintenance.armedNotice")}
              </p>
            )}
            {readFailed && (
              <p className="text-sm text-destructive">
                {t("settings.maintenance.unknownStatus")}
              </p>
            )}
          </div>
        )}
      </header>
      <main className="pb-content-safe">
        <Outlet />
      </main>
      <BottomNavigation />
    </div>
  )
}

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: "/",
      element: (
        <MaintenanceTokenProvider>
          <AppLayout />
        </MaintenanceTokenProvider>
      ),
      children: [
        { index: true, element: <Navigate to="/encrypt" replace /> },
        { path: "encrypt", element: <EncryptPage /> },
        { path: "decrypt", element: <DecryptPage /> },
        { path: "keys", element: <KeyListPage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <Navigate to="/encrypt" replace /> },
      ],
    },
  ])
}
