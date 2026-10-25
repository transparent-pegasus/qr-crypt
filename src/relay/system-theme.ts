export function followSystemTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const syncTheme = () => {
    document.documentElement.classList.toggle("dark", media.matches)
  }
  syncTheme()
  media.addEventListener("change", syncTheme)
  return () => media.removeEventListener("change", syncTheme)
}
