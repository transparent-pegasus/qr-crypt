import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles/globals.css"
import { App } from "./app/App"

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("root element not found")

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
