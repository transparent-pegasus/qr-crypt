import "./boot-test-support"
import { waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  createWipeCoordinator,
  installWipeBroadcastListener,
} from "@/app/boot/wipe-coordinator"
import { recordReceipt, type ReceiptSubject } from "@/features/receipt-cache"

describe("WipeCoordinator order", () => {
  it("clears session receipts during the buffer-drop step", async () => {
    const subject: ReceiptSubject = {
      kind: "sym",
      recipientKeyId: "wipe-recipient",
      envelopeHash: "wipe-envelope",
    }
    expect(recordReceipt(subject, 100)).toEqual({ kind: "first-seen" })

    const coordinator = createWipeCoordinator({
      engageBarrier: () => undefined,
      disposeCrypto: () => undefined,
      coordinateTabs: () => undefined,
      withExclusiveLock: (operation) => operation(),
      bestEffortReset: async () => ({ ok: true, failedSteps: [] }),
    })
    await coordinator.wipe({
      reason: "online-detected",
      resetChurnMb: 0,
      resetTransient: () => undefined,
    })

    expect(recordReceipt(subject, 200)).toEqual({ kind: "first-seen" })
  })

  it("runs the fail-closed sequence once in its frozen order", async () => {
    const order: string[] = []
    const coordinator = createWipeCoordinator({
      engageBarrier: () => {
        order.push("1-barrier")
      },
      disposeCrypto: () => {
        order.push("2-worker")
      },
      dropVaultKeyCacheAndReceipts: () => {
        order.push("2-vault-cache")
      },
      coordinateTabs: () => {
        order.push("4-tabs")
      },
      withExclusiveLock: async <T,>(operation: () => Promise<T>) => {
        order.push("4-lock")
        return operation()
      },
      bestEffortReset: async () => {
        order.push("5-7-reset")
        return { ok: true, failedSteps: [] }
      },
    })

    const report = await coordinator.wipe({
      reason: "online-detected",
      resetChurnMb: 0,
      endSession: () => order.push("0-relay"),
      resetTransient: () => order.push("3-transient"),
    })
    await coordinator.wipe({
      reason: "online-detected",
      resetChurnMb: 0,
      endSession: () => order.push("unexpected-relay"),
      resetTransient: () => order.push("unexpected"),
    })

    expect(report).toEqual({ ok: true, failedSteps: [] })
    expect(order).toEqual([
      "0-relay",
      "1-barrier",
      "2-worker",
      "2-vault-cache",
      "3-transient",
      "4-tabs",
      "4-lock",
      "5-7-reset",
    ])
  })

  it("stops a relay before the barrier on a peer wipe broadcast", async () => {
    let messageHandler: ((event: MessageEvent<unknown>) => void) | undefined
    class FakeBroadcastChannel {
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        if (type === "message") messageHandler = listener
      }
      close() {}
      postMessage() {}
      removeEventListener() {
        messageHandler = undefined
      }
    }
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel)
    const order: string[] = []
    const remove = installWipeBroadcastListener(
      {
        endSession: () => order.push("relay-stop"),
        resetTransient: () => order.push("transient"),
      },
      {
        closeDatabase: () => order.push("close-db"),
        disposeCrypto: () => order.push("crypto"),
        dropVaultKeyCacheAndReceipts: async () => {
          order.push("vault")
        },
        engageBarrier: () => order.push("barrier"),
      },
    )

    messageHandler?.(
      new MessageEvent("message", {
        data: { type: "qr-crypt-wipe-request", version: 1 },
      }),
    )
    expect(order.indexOf("relay-stop")).toBe(0)
    expect(order.indexOf("relay-stop")).toBeLessThan(order.indexOf("barrier"))
    await waitFor(() =>
      expect(order).toEqual([
        "relay-stop",
        "barrier",
        "crypto",
        "vault",
        "transient",
        "close-db",
      ]),
    )
    remove()
  })
})
