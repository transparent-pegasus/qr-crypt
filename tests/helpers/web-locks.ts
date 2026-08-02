// jsdom exposes no Web Locks API, and the sensitive-write exclusion the boot
// proof depends on is unobservable without one. Node already ships a real
// implementation, so this installs nothing there.
//
// ponytail: every request is serialized regardless of mode. A real
// implementation lets shared holders overlap; nothing here asserts that, only
// that a writer and the proof cannot overlap. Give it real shared semantics if
// a test ever needs two writers running at once.
type LockCallback<T> = (lock: unknown) => Promise<T>

const chains = new Map<string, Promise<unknown>>()

function request<T>(
  name: string,
  optionsOrCallback: LockOptions | LockCallback<T>,
  maybeCallback?: LockCallback<T>,
): Promise<T> {
  const callback = (
    typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback
  ) as LockCallback<T>
  const mode =
    typeof optionsOrCallback === "function"
      ? "exclusive"
      : (optionsOrCallback.mode ?? "exclusive")
  const previous = chains.get(name) ?? Promise.resolve()
  const result = previous.then(() => callback({ name, mode }))
  chains.set(
    name,
    result.then(
      () => undefined,
      () => undefined,
    ),
  )
  return result
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
