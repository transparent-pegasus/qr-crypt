export function setTestOnlineStatus(
  online: boolean,
  { emit = false }: { emit?: boolean } = {},
): void {
  Object.defineProperty(navigator, "onLine", {
    value: online,
    configurable: true,
  })
  if (emit) window.dispatchEvent(new Event(online ? "online" : "offline"))
}
