import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'

import { fromStoredJson, toStoredJson } from '@/lib/storedJson'
import type { DeviceStore } from '@/platform/storage/deviceStore'

/**
 * The persisted read cache — ARCHITECTURE.md §M.2: opening the app with no
 * signal shows what this device last loaded, marked as such, rather than a
 * spinner that never ends.
 *
 * One copy, tagged with the user it belongs to. Query keys carry no user id, so
 * a copy restored for anyone else would show them someone else's money: it is
 * deleted instead (SECURITY.md T20). Sign-out deletes it too.
 */
export const QUERY_CACHE_KEY = 'mm.query-cache.v1'

/** Bump when a cached query's data changes shape; older copies are then discarded. */
export const QUERY_CACHE_VERSION = '1'

/** A copy older than this is not worth showing. */
export const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** The cache changes on every fetch; write at most this often. */
const WRITE_DELAY_MS = 1000

interface Stored {
  readonly userId: string
  readonly client: PersistedClient
}

export interface UserQueryPersister extends Persister {
  /** Drops a write that has not happened yet — before sign-out deletes the copy. */
  cancel(): void
}

export function userQueryPersister(store: DeviceStore, userId: string): UserQueryPersister {
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest: PersistedClient | undefined

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    persistClient(client) {
      latest = client
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        if (latest === undefined) return
        void store.set(QUERY_CACHE_KEY, toStoredJson({ userId, client: latest })).catch(() => {
          // A cache that could not be written is only a slower start next time.
        })
      }, WRITE_DELAY_MS)
    },
    async restoreClient() {
      const text = await store.get(QUERY_CACHE_KEY)
      if (text === null) return undefined
      try {
        const stored = fromStoredJson(text) as Partial<Stored> | null
        if (stored?.userId === userId && stored.client !== undefined) return stored.client
      } catch {
        // Unreadable: treated like someone else's copy.
      }
      await store.remove(QUERY_CACHE_KEY)
      return undefined
    },
    async removeClient() {
      cancel()
      await store.remove(QUERY_CACHE_KEY)
    },
    cancel,
  }
}
