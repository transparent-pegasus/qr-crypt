// Window-realm-scoped receipts for authenticated messages accepted since this
// app window loaded or the cache was last cleared.
//
// Rules (frozen):
//   - Memory only. Nothing here is written to IndexedDB, localStorage, or CacheStorage:
//     a persisted ciphertext digest would be a frame-derived value, which
//     docs/security/threat-model.md:11 (and T11/T19) state this app never stores, and
//     which the clean-origin boot gate relies on.
//   - Record only after AEAD authentication and, for signed suites, signature
//     verification have both succeeded.
//   - firstSeenAt is local time at the first sighting and is never refreshed. The
//     sender's own createdAt is never a freshness source.
//   - Detection is not shared with other tabs/windows and resets on reload,
//     transient clear, or wipe. The bounded map evicts its oldest entries.
export const MAX_SESSION_RECEIPTS = 500

export type ReceiptSubject =
  | { kind: "aes"; recipientKeyId: string; envelopeHash: string }
  | {
      kind: "pq-unsigned"
      recipientKemKeyId: string
      messageIdHex: string
      envelopeHash: string
    }
  | {
      kind: "pq-signed"
      recipientKemKeyId: string
      senderFingerprint: string
      messageIdHex: string
      envelopeHash: string
    }

export type ReceiptVerdict =
  | { kind: "first-seen" }
  | { kind: "already-received"; firstSeenAt: number }
  | { kind: "message-id-reused"; firstSeenAt: number }

interface Receipt {
  envelopeHash: string
  firstSeenAt: number
}

// Insertion-ordered, so the first key is always the oldest entry.
const receipts = new Map<string, Receipt>()

function subjectKey(subject: ReceiptSubject): string {
  switch (subject.kind) {
    case "aes":
      // No message id exists in v1, so identity is the ciphertext itself: only a
      // matching ciphertext hash is treated as the same receipt.
      return `aes\n${subject.recipientKeyId}\n${subject.envelopeHash}`
    case "pq-unsigned":
      return `pq-unsigned\n${subject.recipientKemKeyId}\n${subject.messageIdHex}`
    case "pq-signed":
      return `pq-signed\n${subject.senderFingerprint}\n${subject.recipientKemKeyId}\n${subject.messageIdHex}`
  }
}

export function recordReceipt(subject: ReceiptSubject, now: number): ReceiptVerdict {
  const key = subjectKey(subject)
  const existing = receipts.get(key)
  if (existing !== undefined) {
    return existing.envelopeHash === subject.envelopeHash
      ? { kind: "already-received", firstSeenAt: existing.firstSeenAt }
      : { kind: "message-id-reused", firstSeenAt: existing.firstSeenAt }
  }
  receipts.set(key, { envelopeHash: subject.envelopeHash, firstSeenAt: now })
  while (receipts.size > MAX_SESSION_RECEIPTS) {
    const oldest = receipts.keys().next()
    if (oldest.done === true) break
    receipts.delete(oldest.value)
  }
  return { kind: "first-seen" }
}

export function clearReceipts(): void {
  receipts.clear()
}
