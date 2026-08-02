// jsdom exposes no Web Locks API, and the sensitive-write exclusion the boot
// proof depends on is unobservable without one. Node already ships a real
// implementation, so this installs nothing there.
//
// The modes are the whole point, so this schedules by mode rather than
// serializing everything: a stub that chains every request onto the previous one
// behaves identically whether the boot proof asks for `exclusive` or `shared`,
// which is exactly the property under test. Requests are granted in arrival
// order — shared holders overlap, an exclusive request waits for every holder
// ahead of it, and nothing behind an exclusive request may overtake it. A
// pending request whose signal aborts rejects with the signal's reason and never
// runs its callback.
type LockCallback<T> = (lock: unknown) => Promise<T>

interface Waiter {
  mode: LockMode
  granted: boolean
  start: () => void
}

const queues = new Map<string, Waiter[]>()

function pump(name: string): void {
  const queue = queues.get(name)
  if (queue === undefined) return
  let sharedAhead = false
  for (const waiter of queue) {
    if (!waiter.granted) {
      if (waiter.mode === "exclusive" && sharedAhead) return
      waiter.granted = true
      waiter.start()
    }
    if (waiter.mode === "exclusive") return
    sharedAhead = true
  }
}

function request<T>(
  name: string,
  optionsOrCallback: LockOptions | LockCallback<T>,
  maybeCallback?: LockCallback<T>,
): Promise<T> {
  const callback = (
    typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
  ) as LockCallback<T>
  const options: LockOptions =
    typeof optionsOrCallback === "function" ? {} : optionsOrCallback
  const mode = options.mode ?? "exclusive"
  const signal = options.signal ?? undefined
  const queue = queues.get(name) ?? []
  queues.set(name, queue)

  return new Promise<T>((resolve, reject) => {
    const release = (settle: () => void) => {
      const index = queue.indexOf(waiter)
      if (index >= 0) queue.splice(index, 1)
      settle()
      pump(name)
    }
    const onAbort = () => release(() => reject(signal?.reason))
    const waiter: Waiter = {
      mode,
      granted: false,
      start() {
        signal?.removeEventListener("abort", onAbort)
        void Promise.resolve()
          .then(() => callback({ name, mode }))
          .then(
            (value) => release(() => resolve(value)),
            (error: unknown) => release(() => reject(error)),
          )
      },
    }
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    queue.push(waiter)
    pump(name)
  })
}

export function installWebLocksStub(): void {
  if (typeof navigator === "undefined") return
  const existing: LockManager | undefined = navigator.locks
  if (existing !== undefined) return
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request, query: async () => ({ held: [], pending: [] }) },
  })
}
