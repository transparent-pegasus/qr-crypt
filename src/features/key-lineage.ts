// Rotation lineages: a record whose id no other record names in rotatedFromId
// is a head; its previous generations follow the rotatedFromId chain
// newest-to-oldest, stopping at a missing link or an already-visited id.
export interface LineageRecord {
  id: string
  // Matches StoredKeyRecord (`string | undefined`) under exactOptionalPropertyTypes;
  // PostQuantumIdentity's optional `string` is still assignable.
  rotatedFromId?: string | undefined
}

export interface LineageGroup<T extends LineageRecord> {
  head: T
  previous: T[]
}

export function groupLineages<T extends LineageRecord>(
  records: readonly T[],
): LineageGroup<T>[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  const superseded = new Set(
    records
      .map((record) => record.rotatedFromId)
      .filter((id): id is string => id !== undefined),
  )
  return records
    .filter((record) => !superseded.has(record.id))
    .map((head) => {
      const previous: T[] = []
      const visited = new Set([head.id])
      for (let cursor = head.rotatedFromId; cursor !== undefined; ) {
        const generation = byId.get(cursor)
        if (generation === undefined || visited.has(generation.id)) break
        visited.add(generation.id)
        previous.push(generation)
        cursor = generation.rotatedFromId
      }
      return { head, previous }
    })
}
