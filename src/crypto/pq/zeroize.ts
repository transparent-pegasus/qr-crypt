// Clearing secret byte arrays. JavaScript cannot guarantee complete memory
// erasure because of garbage collection, internal copies, and optimization; state that
// limitation explicitly on the security screen. Silently tolerate fill on a detached
// (already transferred) buffer because it cannot clear anything.

export function zeroize(...views: (Uint8Array | undefined)[]): void {
  for (const view of views) {
    if (view === undefined) continue
    try {
      view.fill(0)
    } catch {
      // Detached ArrayBuffer or equivalent: nothing can be done once the target has moved.
    }
  }
}

// Always clear views after fn completes, including when it throws.
export async function withZeroize<T>(
  views: (Uint8Array | undefined)[],
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn()
  } finally {
    zeroize(...views)
  }
}
