/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string
  readonly VITE_APP_SHORT_NAME?: string
  readonly VITE_DEFAULT_ALGORITHM?: string
  readonly VITE_QR_ERROR_CORRECTION?: string
  readonly VITE_QR_RENDER_SIZE?: string
  readonly VITE_MAX_PLAINTEXT_BYTES?: string
  readonly VITE_ENABLE_RSA?: string
  readonly VITE_ENABLE_ECDH?: string
  readonly VITE_ENABLE_PRIVATE_KEY_EXPORT?: string
  readonly VITE_AUTO_CLEAR_SECONDS?: string
  readonly VITE_BUILD_SHA?: string
}
