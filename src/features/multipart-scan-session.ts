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

  constructor(transferTimeoutMinutes: number, now?: () => number) {
    this.#assembler = new TransferAssembler({
      transferTimeoutMinutes,
      ...(now === undefined ? {} : { now }),
    })
  }

  add(framePayload: string): Promise<TransferState> {
    return this.#assembler.add(framePayload)
  }

  state(): TransferState {
    return this.#assembler.state()
  }

  discard(): void {
    this.#assembler.discard()
    this.#completionClaimed = false
  }

  claimCompletion(): boolean {
    if (this.#completionClaimed) return false
    this.#completionClaimed = true
    return true
  }
}
