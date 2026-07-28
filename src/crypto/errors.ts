// Error model. User-facing messages must not include internal exceptions,
// stack traces, or key material.
import { translate, type Language, type MessageKey } from "@/i18n/messages"

export const ERROR_CODES = [
  "UNSUPPORTED_BROWSER",
  "INVALID_QR_PREFIX",
  "INVALID_QR_PAYLOAD",
  "UNSUPPORTED_PROTOCOL_VERSION",
  "UNSUPPORTED_ALGORITHM",
  "KEY_NOT_FOUND",
  "KEY_TYPE_MISMATCH",
  "ENCRYPTION_FAILED",
  "DECRYPTION_FAILED",
  "QR_TOO_LARGE",
  "STORAGE_FAILED",
  "CAMERA_PERMISSION_DENIED",
  "CAMERA_NOT_AVAILABLE",
  "QR_READER_PREPARATION_TIMEOUT",
  "QR_DECODE_PROGRESS_TIMEOUT",
  "QR_READER_BLOCKED",
  "DUPLICATE_KEY",
  "DUPLICATE_QR",
  // v2 post-quantum additions.
  "KEY_ID_CONFLICT",
  "MESSAGE_ID_REUSED",
  "SIGNATURE_INVALID",
  "SIGNING_KEY_NOT_FOUND",
  "FRAME_MISMATCH",
  "WORKER_UNAVAILABLE",
  "RESET_FAILED",
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES)

export type ErrorMessageKey = Extract<MessageKey, `errors.${ErrorCode}`>

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value)
}

export function errorMessageKey(code: ErrorCode): ErrorMessageKey {
  return `errors.${code}` as ErrorMessageKey
}

export function messageFor(code: ErrorCode, language: Language): string {
  return translate(language, errorMessageKey(code))
}

export class AppError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode) {
    // Store only the code name in message; retain neither internal details nor the
    // originating exception, to prevent disclosure.
    super(code)
    this.name = "AppError"
    this.code = code
  }
}

export function toAppError(error: unknown, fallback: ErrorCode): AppError {
  return error instanceof AppError ? error : new AppError(fallback)
}
