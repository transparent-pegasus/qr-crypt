import { clientsClaim } from "workbox-core"
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"
import { NetworkOnly } from "workbox-strategies"
import type { PrecacheEntry } from "../../scripts/precache-manifest.mjs"

declare const __PRECACHE_MANIFEST__: PrecacheEntry[]

clientsClaim()
precacheAndRoute(__PRECACHE_MANIFEST__)
cleanupOutdatedCaches()
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/about\//],
  }),
)
registerRoute(/\/reachability-sentinel\.txt/, new NetworkOnly())
