import type { TransferState } from "@/qr/multipart/transfer-state"
import { TransferAssembler } from "@/qr/multipart/assemble"

/**
 * The transfer assembler deliberately lives outside MultipartScanPanel. Keeping this
 * object in a page/context preserves collected frames while the camera or dialog is
 * remounted.
 */
export class MultipartScanSession {
  readonly #assembler: TransferAssembler
  #completionClaimed = false
  #addQueue: Promise<void> = Promise.resolve()
  #addGeneration = 0

  constructor(transferTimeoutMinutes: number, now?: () => number) {
    this.#assembler = new TransferAssembler({
      transferTimeoutMinutes,
      ...(now === undefined ? {} : { now }),
    })
  }

  add(framePayload: string): Promise<TransferState> {
    const generation = this.#addGeneration
    const operation = this.#addQueue.then(() =>
      generation === this.#addGeneration
        ? this.#assembler.add(framePayload)
        : this.#assembler.state(),
    )
    this.#addQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  state(): TransferState {
    return this.#assembler.state()
  }

  discard(): void {
    this.#addGeneration += 1
    this.#assembler.discard()
    this.#completionClaimed = false
  }

  /**
   * Runs `deliver` at most once per completed transfer. Returns null — synchronously,
   * before `deliver` is called — when another caller already owns the completion, so a
   * second scanner surface can tell "someone else has it" from "it is mine to send"
   * without a separate claim call.
   *
   * A rejected delivery hands the claim back and rethrows. Without that the scanner
   * re-enables its Start button over a session that can never deliver again, and the
   * only way out is rescanning every frame. Release lives here rather than in the
   * caller because delivery nests — the panel calls through the modal — and only the
   * outermost owner can release exactly once. Whoever retries after a failure owns not
   * re-claiming on a timer; see the closed-session poller in QrScannerModal.
   */
  deliverOnce(deliver: () => void | Promise<void>): Promise<void> | null {
    if (this.#completionClaimed) return null
    this.#completionClaimed = true
    return (async () => {
      try {
        await deliver()
      } catch (error) {
        this.#completionClaimed = false
        throw error
      }
    })()
  }
}
