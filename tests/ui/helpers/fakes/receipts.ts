import { vi } from "vitest"
import type { ReceiptSubject, ReceiptVerdict } from "@/features/receipt-cache"
import { registerFakeReset } from "./reset"

export const recordReceipt = vi.fn<
  (subject: ReceiptSubject, now: number) => ReceiptVerdict
>(() => ({ kind: "first-seen" }) as const)

registerFakeReset(() => {
  recordReceipt.mockImplementation(() => ({ kind: "first-seen" }) as const)
})
