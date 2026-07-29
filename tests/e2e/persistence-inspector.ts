import type { Page } from "@playwright/test"

export interface PersistenceNeedle {
  marker: string
  text?: string
  bytes?: ArrayLike<number>
}

export interface PersistenceMatch {
  marker: string
  location: string
}

export interface PersistenceInspection {
  matches: PersistenceMatch[]
  indexedDbStores: string[]
  localStorageKeys: string[]
  cacheKeys: string[]
}

/**
 * Recursively scans every IndexedDB plus CacheStorage metadata/body and local
 * storage. Text needles are also searched as UTF-8 bytes; explicit byte
 * needles catch typed arrays and other structured-clone binary values.
 */
export async function inspectPersistentSurfaces(
  page: Page,
  needles: readonly PersistenceNeedle[],
): Promise<PersistenceInspection> {
  const serialized = needles.map(({ marker, text, bytes }) => ({
    marker,
    text,
    bytes: bytes === undefined ? undefined : Array.from(bytes),
  }))
  return page.evaluate(async (candidateNeedles) => {
    interface Match {
      marker: string
      location: string
    }

    const encoder = new TextEncoder()
    const preparedNeedles = candidateNeedles.map((needle) => ({
      marker: needle.marker,
      text: needle.text,
      byteValues: [
        ...(needle.text === undefined ? [] : [encoder.encode(needle.text)]),
        ...(needle.bytes === undefined
          ? []
          : [Uint8Array.from(needle.bytes)]),
      ],
    }))
    const found = new Map<string, Match>()
    const addMatch = (marker: string, location: string): void => {
      found.set(`${marker}\n${location}`, { marker, location })
    }
    const containsBytes = (
      haystack: Uint8Array,
      needle: Uint8Array,
    ): boolean => {
      if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) {
        return false
      }
      outer: for (
        let offset = 0;
        offset <= haystack.byteLength - needle.byteLength;
        offset += 1
      ) {
        for (let index = 0; index < needle.byteLength; index += 1) {
          if (haystack[offset + index] !== needle[index]) continue outer
        }
        return true
      }
      return false
    }
    const inspectString = (value: string, location: string): void => {
      for (const needle of preparedNeedles) {
        if (needle.text !== undefined && value.includes(needle.text)) {
          addMatch(needle.marker, `${location}:text`)
        }
      }
    }
    const inspectBytes = (value: Uint8Array, location: string): void => {
      for (const needle of preparedNeedles) {
        if (
          needle.byteValues.some((candidate) =>
            containsBytes(value, candidate),
          )
        ) {
          addMatch(needle.marker, `${location}:bytes`)
        }
      }
    }
    const inspectValue = async (
      value: unknown,
      location: string,
      seen: WeakSet<object>,
    ): Promise<void> => {
      if (typeof value === "string") {
        inspectString(value, location)
        return
      }
      if (
        typeof value === "number" ||
        typeof value === "bigint" ||
        typeof value === "boolean"
      ) {
        inspectString(String(value), location)
        return
      }
      if (value instanceof ArrayBuffer) {
        inspectBytes(new Uint8Array(value), location)
        return
      }
      if (ArrayBuffer.isView(value)) {
        inspectBytes(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
          location,
        )
        return
      }
      if (value instanceof Blob) {
        inspectBytes(new Uint8Array(await value.arrayBuffer()), location)
        return
      }
      if (typeof value !== "object" || value === null || seen.has(value)) return
      seen.add(value)
      if (value instanceof Map) {
        let index = 0
        for (const [key, entry] of value.entries()) {
          await inspectValue(key, `${location}.mapKey[${index}]`, seen)
          await inspectValue(entry, `${location}.mapValue[${index}]`, seen)
          index += 1
        }
        return
      }
      if (value instanceof Set) {
        let index = 0
        for (const entry of value.values()) {
          await inspectValue(entry, `${location}.setValue[${index}]`, seen)
          index += 1
        }
        return
      }
      if (Array.isArray(value)) {
        for (const [index, entry] of value.entries()) {
          await inspectValue(entry, `${location}[${index}]`, seen)
        }
        return
      }
      for (const [key, entry] of Object.entries(value)) {
        inspectString(key, `${location}.property`)
        await inspectValue(entry, `${location}.${key}`, seen)
      }
    }
    const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
    const openDatabase = (name: string): Promise<IDBDatabase> =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onerror = () => reject(request.error)
        request.onblocked = () =>
          reject(new Error(`IndexedDB open was blocked: ${name}`))
        request.onsuccess = () => resolve(request.result)
      })

    const indexedDbStores: string[] = []
    const databaseEntries = (await indexedDB.databases())
      .filter(
        (entry): entry is IDBDatabaseInfo & { name: string } =>
          typeof entry.name === "string",
      )
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of databaseEntries) {
      inspectString(entry.name, `indexedDB:${entry.name}:database-name`)
      const database = await openDatabase(entry.name)
      try {
        for (const storeName of Array.from(database.objectStoreNames).sort()) {
          const storeLocation = `indexedDB:${entry.name}/${storeName}`
          indexedDbStores.push(`${entry.name}/${storeName}`)
          inspectString(storeName, `${storeLocation}:store-name`)
          const transaction = database.transaction(storeName, "readonly")
          const store = transaction.objectStore(storeName)
          await inspectValue(
            store.keyPath,
            `${storeLocation}:key-path`,
            new WeakSet(),
          )
          for (const indexName of Array.from(store.indexNames).sort()) {
            const index = store.index(indexName)
            const indexLocation = `${storeLocation}.indexes[${indexName}]`
            inspectString(indexName, `${indexLocation}:name`)
            await inspectValue(
              index.keyPath,
              `${indexLocation}:key-path`,
              new WeakSet(),
            )
          }
          const [keys, values] = await Promise.all([
            requestResult(store.getAllKeys()),
            requestResult(store.getAll()),
          ])
          for (const [index, key] of keys.entries()) {
            await inspectValue(
              key,
              `${storeLocation}.keys[${index}]`,
              new WeakSet(),
            )
          }
          for (const [index, value] of values.entries()) {
            await inspectValue(
              value,
              `${storeLocation}.values[${index}]`,
              new WeakSet(),
            )
          }
        }
      } finally {
        database.close()
      }
    }

    const localStorageKeys = Object.keys(localStorage).sort()
    for (const key of localStorageKeys) {
      inspectString(key, `localStorage:${key}:key`)
      inspectString(localStorage.getItem(key) ?? "", `localStorage:${key}:value`)
    }

    const cacheKeys: string[] = []
    for (const cacheName of (await caches.keys()).sort()) {
      inspectString(cacheName, `CacheStorage:${cacheName}:name`)
      const cache = await caches.open(cacheName)
      const requests = await cache.keys()
      for (const request of requests) {
        const requestLocation = `CacheStorage:${cacheName}:${request.method}:${request.url}`
        cacheKeys.push(`${cacheName}:${request.method}:${request.url}`)
        inspectString(request.url, `${requestLocation}:url`)
        inspectString(request.method, `${requestLocation}:method`)
        for (const [name, value] of request.headers.entries()) {
          inspectString(name, `${requestLocation}:request-header-name`)
          inspectString(value, `${requestLocation}:request-header:${name}`)
        }
        const response = await cache.match(request)
        if (response === undefined) {
          throw new Error(`CacheStorage body was unavailable: ${request.url}`)
        }
        inspectString(response.url, `${requestLocation}:response-url`)
        inspectString(String(response.status), `${requestLocation}:response-status`)
        inspectString(response.statusText, `${requestLocation}:response-status-text`)
        for (const [name, value] of response.headers.entries()) {
          inspectString(name, `${requestLocation}:response-header-name`)
          inspectString(value, `${requestLocation}:response-header:${name}`)
        }
        inspectBytes(
          new Uint8Array(await response.clone().arrayBuffer()),
          `${requestLocation}:response-body`,
        )
      }
    }

    return {
      matches: [...found.values()].sort((left, right) =>
        `${left.marker}:${left.location}`.localeCompare(
          `${right.marker}:${right.location}`,
        ),
      ),
      indexedDbStores,
      localStorageKeys,
      cacheKeys: cacheKeys.sort(),
    }
  }, serialized)
}
