// v2 QR payloads. The prefix table and frame codec are frozen wire contracts; see
// docs/spec/qr-protocol-v2.md §1 and §6. Typed-envelope decoding, assembly, and UI wiring
// build on this module.
//
// Policy:
//   - OCM2/OCP2/OCS2/OCI2 are the single-payload representation (paste/file import)
//     and the logical type.
//   - Display always uses OCF2 (frameCount≥1). Frame chunks split raw artifact-CBOR
//     bytes directly; re-encoding an inner string as base64url is prohibited.
//   - OCB2 is reserved only: unconditionally rejected everywhere (never generate,
//     never accept).
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { decodeQrFrameV2, encodeQrFrameV2 } from "@/crypto/pq/canonical-cbor"
import { fromBase64Url, toBase64Url } from "@/lib/base64url"
import {
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  MAX_FRAME_PAYLOAD_CHARS,
} from "@/lib/limits"

// artifactType ↔ prefix mapping; reusing v1 prefixes is prohibited.
export const QR_PREFIX_V2 = {
  "pq-message": "OCM2:",
  "pq-kem-public-key": "OCP2:",
  "pq-dsa-public-key": "OCS2:",
  "pq-public-identity": "OCI2:",
  "encrypted-seed-backup": "OCB2:",
  frame: "OCF2:",
} as const

export type V2PayloadKind = V2ArtifactType | "frame"

// Character limit for a complete v2 payload on the paste path: base64url of the
// 128-frame × 1,000-byte absolute artifact ceiling plus the prefix.
// MAX_FRAME_PAYLOAD_CHARS separately limits the frame path.
export const MAX_V2_PAYLOAD_CHARS =
  Math.ceil((MAX_ARTIFACT_BYTES_ABSOLUTE * 4) / 3) +
  QR_PREFIX_V2["pq-message"].length

export interface ClassifiedV2Payload {
  kind: V2PayloadKind
  prefix: string
}

// Detect a v2 prefix. Return null for non-v2 input so the caller can delegate to the v1 path.
export function classifyV2Payload(text: string): ClassifiedV2Payload | null {
  for (const [kind, prefix] of Object.entries(QR_PREFIX_V2) as [
    V2PayloadKind,
    string,
  ][]) {
    if (text.startsWith(prefix)) return { kind, prefix }
  }
  return null
}

// Single payload (bare OC?2) → raw artifact bytes. The caller performs typed validation
// through validation.ts or the corresponding canonical-cbor decoder.
export function splitV2Payload(text: string): { kind: V2ArtifactType; bytes: Uint8Array } {
  const classified = classifyV2Payload(text)
  if (classified === null) throw new AppError("INVALID_QR_PREFIX")
  if (classified.kind === "frame") throw new AppError("INVALID_QR_PAYLOAD")
  if (classified.kind === "encrypted-seed-backup") {
    // Reserved prefix: unconditionally rejected.
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  if (text.length > MAX_V2_PAYLOAD_CHARS) throw new AppError("INVALID_QR_PAYLOAD")
  const body = text.slice(classified.prefix.length)
  if (body.length === 0) throw new AppError("INVALID_QR_PAYLOAD")
  try {
    const bytes = fromBase64Url(body)
    if (bytes.byteLength > MAX_ARTIFACT_BYTES_ABSOLUTE) {
      throw new AppError("INVALID_QR_PAYLOAD")
    }
    return { kind: classified.kind, bytes }
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}

// Raw artifact bytes → single payload string (bare OC?2).
export function buildV2Payload(kind: V2ArtifactType, bytes: Uint8Array): string {
  if (kind === "encrypted-seed-backup") throw new AppError("UNSUPPORTED_ALGORITHM")
  return `${QR_PREFIX_V2[kind]}${toBase64Url(bytes)}`
}

// ---------------------------------------------------------------------------
// Frozen OCF2 frame codec; split/assemble operate on top of it.
// ---------------------------------------------------------------------------

export function encodeFrameToPayload(frame: QrFrameV2): string {
  const payload = `${QR_PREFIX_V2.frame}${toBase64Url(encodeQrFrameV2(frame))}`
  if (payload.length > MAX_FRAME_PAYLOAD_CHARS) {
    // This indicates a generation-side bug such as an incorrect frameBytes clamp.
    // Never return a string that cannot be displayed at EC-Q.
    throw new AppError("QR_TOO_LARGE")
  }
  return payload
}

export function decodeFramePayload(text: string): QrFrameV2 {
  if (!text.startsWith(QR_PREFIX_V2.frame)) throw new AppError("INVALID_QR_PREFIX")
  if (text.length > MAX_FRAME_PAYLOAD_CHARS) throw new AppError("INVALID_QR_PAYLOAD")
  const body = text.slice(QR_PREFIX_V2.frame.length)
  if (body.length === 0) throw new AppError("INVALID_QR_PAYLOAD")
  try {
    return decodeQrFrameV2(fromBase64Url(body))
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}
