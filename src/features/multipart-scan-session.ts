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

  claimCompletion(): boolean {
    if (this.#completionClaimed) return false
    this.#completionClaimed = true
    return true
  }

  // Delivery failed, so the claim goes back. Without this the scanner re-enables
  // its Start button over a session that can never deliver again, and the only
  // way out is rescanning every frame. Whoever releases owns not re-claiming on
  // a timer — see the closed-session poller in QrScannerModal.
  releaseCompletion(): void {
    this.#completionClaimed = false
  }
}
