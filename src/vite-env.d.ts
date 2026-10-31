/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare const __APP_VERSION__: string

declare const __DEPLOYMENT_HEADER_POLICY__: {
  root: Record<string, string>
  sentinelCacheControl: string
}

interface ImportMetaEnv {
  readonly VITE_DEFAULT_ALGORITHM?: string
  readonly VITE_QR_RENDER_SIZE?: string
  readonly VITE_MAX_PLAINTEXT_BYTES?: string
  readonly VITE_QR_FRAME_BYTES?: string
  readonly VITE_QR_FRAME_INTERVAL_MS?: string
  readonly VITE_QR_MAX_FRAMES?: string
  readonly VITE_AUTO_CLEAR_SECONDS?: string
  readonly VITE_AUTO_CLEAR_FALLBACK_SECONDS?: string
  readonly VITE_BUILD_SHA?: string
}
