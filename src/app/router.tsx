import { Navigate, Outlet, createBrowserRouter } from "react-router"
import { env } from "@/schemas/env-schema"
import { BottomNavigation } from "@/components/bottom-navigation"
import { NetworkStatusBadge } from "@/components/network-status"
import { EncryptPage } from "@/pages/encrypt-page"
import { KeyListPage } from "@/pages/key-list-page"
import { KeysPage } from "@/pages/keys-page"
import { SettingsPage } from "@/pages/settings-page"

export function AppLayout() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 pt-safe backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-md items-center justify-between gap-3 px-4">
          <h1 className="truncate text-[1.375rem] font-bold tracking-tight">
            {env.appName}
          </h1>
          <NetworkStatusBadge />
        </div>
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
      element: <AppLayout />,
      children: [
        { index: true, element: <Navigate to="/encrypt" replace /> },
        { path: "encrypt", element: <EncryptPage /> },
        { path: "keys", element: <KeysPage /> },
        { path: "saved", element: <KeyListPage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <Navigate to="/encrypt" replace /> },
      ],
    },
  ])
}
