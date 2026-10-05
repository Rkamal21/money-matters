import { useQueryClient } from '@tanstack/react-query'
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from '@tanstack/react-query-persist-client'
import { useEffect } from 'react'

import { useSession } from '@/lib/session'
import { deviceStore } from '@/platform/storage/deviceStore'

import {
  QUERY_CACHE_KEY,
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_CACHE_VERSION,
  userQueryPersister,
} from './queryPersister'

/**
 * Keeps the signed-in user's query cache on the device and restores it on the
 * next start (./queryPersister.ts). Android only: on the web there is no
 * device store, and nothing is kept (SECURITY.md T20).
 */
export function QueryPersistence() {
  const queryClient = useQueryClient()
  const session = useSession()
  const status = session.status
  const userId = session.status === 'signed_in' ? session.user.userId : null

  useEffect(() => {
    const store = deviceStore()
    if (store === null || status === 'loading') return
    if (userId === null) {
      void store.remove(QUERY_CACHE_KEY).catch(() => undefined)
      return
    }

    const persister = userQueryPersister(store, userId)
    let active = true
    let unsubscribe: (() => void) | undefined
    void persistQueryClientRestore({
      queryClient,
      persister,
      maxAge: QUERY_CACHE_MAX_AGE_MS,
      buster: QUERY_CACHE_VERSION,
    }).then(() => {
      if (!active) return
      unsubscribe = persistQueryClientSubscribe({
        queryClient,
        persister,
        buster: QUERY_CACHE_VERSION,
      })
    })

    return () => {
      active = false
      unsubscribe?.()
      persister.cancel()
    }
  }, [queryClient, status, userId])

  return null
}
