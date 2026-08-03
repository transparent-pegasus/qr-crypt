import { describe, expect, it } from "vitest"
import { groupLineages } from "@/features/key-lineage"

interface TestRecord {
  id: string
  rotatedFromId?: string
  name: string
}

const record = (id: string, rotatedFromId?: string): TestRecord => ({
  id,
  ...(rotatedFromId === undefined ? {} : { rotatedFromId }),
  name: `record-${id}`,
})

describe("groupLineages", () => {
  it("keeps independent records as their own heads with no predecessors", () => {
    const groups = groupLineages([record("a"), record("b")])
    expect(groups.map(({ head }) => head.id).sort()).toEqual(["a", "b"])
    expect(groups.every(({ previous }) => previous.length === 0)).toBe(true)
  })

  it("orders a chain newest-to-oldest under its head", () => {
    const oldest = record("g1")
    const middle = record("g2", "g1")
    const head = record("g3", "g2")
    const groups = groupLineages([oldest, head, middle])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.head).toBe(head)
    expect(groups[0]?.previous.map(({ id }) => id)).toEqual(["g2", "g1"])
  })

  it("returns the same groups regardless of input order", () => {
    const records = [record("g1"), record("g2", "g1"), record("g3", "g2"), record("x")]
    const keyOf = (groups: ReturnType<typeof groupLineages<TestRecord>>) =>
      groups
        .map(({ head, previous }) => `${head.id}<${previous.map(({ id }) => id).join(",")}`)
        .sort()
    expect(keyOf(groupLineages([...records].reverse()))).toEqual(
      keyOf(groupLineages(records)),
    )
  })

  it("stops the walk at a missing predecessor without dropping the head", () => {
    const groups = groupLineages([record("head", "gone")])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.head.id).toBe("head")
    expect(groups[0]?.previous).toEqual([])
  })

  it("terminates on cyclic metadata and keeps every reached generation", () => {
    const first = record("a", "b")
    const second = record("b", "a")
    const head = record("head", "a")
    const groups = groupLineages([first, second, head])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.head).toBe(head)
    expect(groups[0]?.previous.map(({ id }) => id)).toEqual(["a", "b"])
  })

  it("lists a predecessor claimed by two successors under both heads", () => {
    const shared = record("shared")
    const groups = groupLineages([record("h1", "shared"), record("h2", "shared"), shared])
    expect(groups.map(({ head }) => head.id).sort()).toEqual(["h1", "h2"])
    expect(groups.every(({ previous }) => previous[0]?.id === "shared")).toBe(true)
  })

  it("pins current behavior: a self-referencing record disappears entirely", () => {
    // Pre-existing behavior in every prior copy: rotatedFromId === id marks the
    // record superseded by itself, so it is neither a head nor reachable.
    // Changing this is a deliberate follow-up decision, not part of the fold.
    expect(groupLineages([record("self", "self")])).toEqual([])
  })
})
