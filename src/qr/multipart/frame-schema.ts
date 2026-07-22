// QrFrameV2 の zod strict 検証(WP-12)。canonical-cbor.guardQrFrameV2 の
// プロトコル定数検査に加え、schema としての再検証面を提供する
// (二重検証は意図的 — QR 由来入力は hostile 前提)。
import type { QrFrameV2 } from "@/schemas/domain"

export function validateQrFrameV2Strict(value: unknown): QrFrameV2 {
  void value
  throw new Error("NOT_IMPLEMENTED: WP-12 validateQrFrameV2Strict")
}
