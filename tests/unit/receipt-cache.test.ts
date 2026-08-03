import { beforeEach, describe, expect, it } from "vitest"
import {
  clearReceipts,
  MAX_SESSION_RECEIPTS,
  recordReceipt,
  type ReceiptSubject,
} from "@/features/receipt-cache"

const FIRST_SEEN_AT = 1_700_000_000_000

type SignedReceiptSubject = Extract<ReceiptSubject, { kind: "pq-signed" }>

function signedSubject(
  envelopeHash = "signed-envelope-a",
  senderFingerprint = "sender-a",
): SignedReceiptSubject {
  return {
    kind: "pq-signed",
    recipientKemKeyId: "recipient-a",
    senderFingerprint,
    messageIdHex: "message-a",
    envelopeHash,
  }
}

describe("session receipt cache", () => {
  beforeEach(() => {
    clearReceipts()
  })

  it("returns the original first-seen time when the same signed ciphertext is received twice", () => {
    const subject = signedSubject()

    expect(recordReceipt(subject, FIRST_SEEN_AT)).toEqual({ kind: "first-seen" })
    expect(recordReceipt(subject, FIRST_SEEN_AT + 1_000)).toEqual({
      kind: "already-received",
      firstSeenAt: FIRST_SEEN_AT,
    })
  })

  it("refuses a signed message-id reuse with different ciphertext", () => {
    expect(recordReceipt(signedSubject("signed-envelope-a"), FIRST_SEEN_AT)).toEqual({
      kind: "first-seen",
    })
    expect(
      recordReceipt(signedSubject("signed-envelope-b"), FIRST_SEEN_AT + 1_000),
    ).toEqual({
      kind: "message-id-reused",
      firstSeenAt: FIRST_SEEN_AT,
    })
  })

  it("separates signed receipts by sender fingerprint", () => {
    expect(recordReceipt(signedSubject("envelope-a", "sender-a"), FIRST_SEEN_AT)).toEqual({
      kind: "first-seen",
    })
    expect(
      recordReceipt(signedSubject("envelope-b", "sender-b"), FIRST_SEEN_AT + 1),
    ).toEqual({ kind: "first-seen" })
  })

  it("keys symmetric receipts by ciphertext so message-id reuse is unreachable", () => {
    const subject: ReceiptSubject = {
      kind: "sym",
      recipientKeyId: "sym-recipient",
      envelopeHash: "sym-envelope-a",
    }

    expect(recordReceipt(subject, FIRST_SEEN_AT)).toEqual({ kind: "first-seen" })
    expect(recordReceipt(subject, FIRST_SEEN_AT + 1)).toEqual({
      kind: "already-received",
      firstSeenAt: FIRST_SEEN_AT,
    })
    expect(
      recordReceipt(
        { ...subject, envelopeHash: "sym-envelope-b" },
        FIRST_SEEN_AT + 2,
      ),
    ).toEqual({ kind: "first-seen" })
  })

  it("does not refresh firstSeenAt on repeated receipts", () => {
    const subject = signedSubject()

    recordReceipt(subject, FIRST_SEEN_AT)
    recordReceipt(subject, FIRST_SEEN_AT + 1_000)
    expect(recordReceipt(subject, FIRST_SEEN_AT + 2_000)).toEqual({
      kind: "already-received",
      firstSeenAt: FIRST_SEEN_AT,
    })
  })

  it("evicts the oldest receipt after the session cap is exceeded", () => {
    const subjectAt = (index: number): ReceiptSubject => ({
      kind: "sym",
      recipientKeyId: "sym-recipient",
      envelopeHash: `sym-envelope-${index}`,
    })

    for (let index = 0; index < MAX_SESSION_RECEIPTS + 1; index += 1) {
      expect(recordReceipt(subjectAt(index), FIRST_SEEN_AT + index)).toEqual({
        kind: "first-seen",
      })
    }
    expect(
      recordReceipt(subjectAt(1), FIRST_SEEN_AT + MAX_SESSION_RECEIPTS + 1),
    ).toEqual({
      kind: "already-received",
      firstSeenAt: FIRST_SEEN_AT + 1,
    })
    expect(
      recordReceipt(subjectAt(0), FIRST_SEEN_AT + MAX_SESSION_RECEIPTS + 2),
    ).toEqual({ kind: "first-seen" })
  })
})
