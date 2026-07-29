import { AppError, errorMessageKey, type ErrorCode } from "@/crypto/errors"
import type { MultipartScanSession } from "@/features/multipart-scan-session"
import type { V2ArtifactType } from "@/schemas/domain"
import type { MessageKey, Translate } from "@/i18n"
import type { InterpolationValues } from "@/i18n/messages"
import { QR_PREFIX } from "@/qr/payload"

export type ScannerTarget = "message" | "symmetric-key" | "public-key"

export const TARGET_PREFIX: Record<ScannerTarget, string> = {
  message: QR_PREFIX.message,
  "symmetric-key": QR_PREFIX["symmetric-key"],
  "public-key": QR_PREFIX["public-key"],
}

export const TARGET_LABEL_KEY: Record<ScannerTarget, MessageKey> = {
  message: "scanner.targetLabel.message",
  "symmetric-key": "scanner.targetLabel.symmetricKey",
  "public-key": "scanner.targetLabel.publicKey",
}

export interface MultipartScanCompletion {
  artifactType: V2ArtifactType
  artifactBytes: Uint8Array
}

interface QrScannerPanelBaseProps {
  singleTargets: ScannerTarget[]
  onSingleScan: (
    target: ScannerTarget,
    payload: string,
  ) => void | Promise<void>
  cameraAvailable?: boolean
  title?: string
  autoStart?: boolean
  stopHint?: string
}

type QrScannerPanelMultipartProps =
  | {
      multipart: {
        session: MultipartScanSession
        onComplete: (
          completion: MultipartScanCompletion,
        ) => void | Promise<void>
      }
    }
  | { multipart?: never }

export type QrScannerPanelProps = QrScannerPanelBaseProps &
  QrScannerPanelMultipartProps

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

export function targetForPayload(payload: string): ScannerTarget | null {
  for (const target of Object.keys(TARGET_PREFIX) as ScannerTarget[]) {
    if (payload.startsWith(TARGET_PREFIX[target])) return target
  }
  return null
}

export function actualPayloadLabel(payload: string, t: Translate): string {
  const target = targetForPayload(payload)
  return target === null
    ? t("scanner.payloadLabel.foreign")
    : t(TARGET_LABEL_KEY[target])
}

export function acceptedPayloadLabel(
  singleTargets: ScannerTarget[],
  acceptsMultipart: boolean,
  t: Translate,
): string {
  const labels = singleTargets.map((target) => t(TARGET_LABEL_KEY[target]))
  if (acceptsMultipart) labels.push(t("scanner.acceptedLabel.multipart"))
  return (
    labels.join(t("scanner.acceptedLabel.separator")) ||
    t("scanner.acceptedLabel.fallback")
  )
}

export function deliveryError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError("INVALID_QR_PAYLOAD")
}
