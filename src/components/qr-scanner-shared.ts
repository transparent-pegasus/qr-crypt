import { AppError, errorMessageKey, type ErrorCode } from "@/crypto/errors"
import type { MultipartScanSession } from "@/features/multipart-scan-session"
import type { V2ArtifactType } from "@/schemas/domain"
import type { MessageKey } from "@/i18n"
import type { InterpolationValues } from "@/i18n/messages"

export interface MultipartScanCompletion {
  artifactType: V2ArtifactType
  artifactBytes: Uint8Array
}

export interface QrScannerPanelProps {
  multipart: {
    session: MultipartScanSession
    onComplete: (
      completion: MultipartScanCompletion,
    ) => void | Promise<void>
  }
  cameraAvailable?: boolean
  title?: string
  autoStart?: boolean
  stopHint?: string
}

export interface LocalizedText {
  key: MessageKey
  values?: InterpolationValues
}

export function localized(
  key: MessageKey,
  values?: InterpolationValues,
): LocalizedText {
  return values === undefined ? { key } : { key, values }
}

export function localizedErrorCode(code: ErrorCode): LocalizedText {
  return localized(errorMessageKey(code))
}

export function deliveryError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError("INVALID_QR_PAYLOAD")
}
