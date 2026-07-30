// Single owner of full-page reload. jsdom defines Location.reload
// non-configurable, so tests mock this module instead of the global.
export function reloadApplication(): void {
  window.location.reload()
}
