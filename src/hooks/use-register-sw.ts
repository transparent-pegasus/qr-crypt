// Seam over the PWA virtual module: vitest cannot resolve
// "virtual:pwa-register/react", so tests mock this module instead.
export { useRegisterSW as useDefaultRegisterSW } from "virtual:pwa-register/react"
