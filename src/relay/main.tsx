import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { FeatureSupportProvider } from "@/app/feature-support"
import { LanguageProvider, readStoredLanguage, syncDocumentLanguage } from "@/i18n"
import { detectFeatures } from "@/lib/feature-detect"
import "../styles/globals.css"
import { RelayApp } from "./relay-app"
import { followSystemTheme } from "./system-theme"

const initialLanguage = readStoredLanguage()
syncDocumentLanguage(initialLanguage)
followSystemTheme()

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("root element not found")

createRoot(rootElement).render(
  <StrictMode>
    <LanguageProvider initialLanguage={initialLanguage}>
      <FeatureSupportProvider features={detectFeatures()}>
        <RelayApp />
      </FeatureSupportProvider>
    </LanguageProvider>
  </StrictMode>,
)
