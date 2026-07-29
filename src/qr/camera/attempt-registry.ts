import type { CameraAttempt } from "@/qr/camera/types"

let nextAttemptId = 0
let activeAttempt: CameraAttempt | null = null

export function createAttemptId(): number {
  nextAttemptId += 1
  return nextAttemptId
}

export function activateAttempt(attempt: CameraAttempt): void {
  activeAttempt = attempt
}

export function currentAttempt(): CameraAttempt | null {
  return activeAttempt
}

export function isActiveAttempt(attempt: CameraAttempt): boolean {
  return activeAttempt?.id === attempt.id && !attempt.stopped
}

export function clearAttempt(attempt: CameraAttempt): void {
  if (activeAttempt?.id === attempt.id) activeAttempt = null
}
