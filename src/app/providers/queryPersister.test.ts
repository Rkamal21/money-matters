import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fromMinor } from '@/domain/money/Money'
import { toStoredJson } from '@/lib/storedJson'
import type { DeviceStore } from '@/platform/storage/deviceStore'

import { QUERY_CACHE_KEY, userQueryPersister } from './queryPersister'

function memoryStore() {
  const data = new Map<string, string>()
  const writes = vi.fn((key: string, value: string) => {
    data.set(key, value)
    return Promise.resolve()
  })
  const store: DeviceStore & { data: Map<string, string>; writes: typeof writes } = {
    data,
    writes,
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: writes,
    remove: (key) => {
      data.delete(key)
      return Promise.resolve()
    },
  }
  return store
}

/** A persisted cache holding one query; only the fields this file reads. */
const client = (balance: bigint) =>
  ({
    timestamp: 1,
    buster: '1',
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ['accounts'],
          queryHash: '["accounts"]',
          state: { data: [{ balance: fromMinor(balance, 'INR') }] },
        },
      ],
    },
  }) as unknown as PersistedClient

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('userQueryPersister', () => {
  it('restores the signed-in user’s copy, money intact', async () => {
    const store = memoryStore()
    const persister = userQueryPersister(store, 'user-a')
    void persister.persistClient(client(123_45n))
    await vi.runAllTimersAsync()

    const restored = await userQueryPersister(store, 'user-a').restoreClient()
    const data = restored?.clientState.queries[0]?.state.data as { balance: { minor: bigint } }[]
    expect(data[0]?.balance.minor).toBe(123_45n)
  })

  it('never restores someone else’s copy, and deletes it', async () => {
    const store = memoryStore()
    store.data.set(QUERY_CACHE_KEY, toStoredJson({ userId: 'user-b', client: client(1n) }))

    expect(await userQueryPersister(store, 'user-a').restoreClient()).toBeUndefined()
    expect(store.data.has(QUERY_CACHE_KEY)).toBe(false)
  })

  it('deletes an unreadable copy instead of failing the start', async () => {
    const store = memoryStore()
    store.data.set(QUERY_CACHE_KEY, '{not json')
    expect(await userQueryPersister(store, 'user-a').restoreClient()).toBeUndefined()
    expect(store.data.has(QUERY_CACHE_KEY)).toBe(false)
  })

  it('writes at most once a second, with the latest state', async () => {
    const store = memoryStore()
    const persister = userQueryPersister(store, 'user-a')
    void persister.persistClient(client(1n))
    void persister.persistClient(client(2n))
    void persister.persistClient(client(3n))
    await vi.runAllTimersAsync()

    expect(store.writes).toHaveBeenCalledTimes(1)
    const restored = await persister.restoreClient()
    const data = restored?.clientState.queries[0]?.state.data as { balance: { minor: bigint } }[]
    expect(data[0]?.balance.minor).toBe(3n)
  })

  it('on sign-out, a write still waiting never lands after the copy is deleted', async () => {
    const store = memoryStore()
    const persister = userQueryPersister(store, 'user-a')
    void persister.persistClient(client(1n))
    await persister.removeClient()
    await vi.runAllTimersAsync()

    expect(store.writes).not.toHaveBeenCalled()
    expect(store.data.has(QUERY_CACHE_KEY)).toBe(false)
  })
})
