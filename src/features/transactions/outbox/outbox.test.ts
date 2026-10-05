import { describe, expect, it, vi } from 'vitest'

import { fromMinor } from '@/domain/money/Money'
import { of } from '@/domain/period/LocalDate'
import { toStoredJson } from '@/lib/storedJson'
import type { DeviceStore } from '@/platform/storage/deviceStore'

import type { CreateRequest } from '../services/saveTransaction'

vi.mock('@/platform/storage/deviceStore', () => ({ deviceStore: () => null }))

const { createOutbox } = await import('./outbox')

function request(id: string, userId = 'user-a'): CreateRequest {
  return {
    userId,
    transaction: {
      kind: 'expense',
      amount: fromMinor(48_600n, 'INR'),
      accountId: 'account-1',
      categoryId: 'category-food',
      description: 'Swiggy',
      occurredOn: of(2026, 10, 6),
      clientRequestId: id,
    },
    splits: null,
  }
}

function memoryStore(
  initial: Record<string, string> = {},
): DeviceStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: (key) => Promise.resolve(data.get(key) ?? null),
    set: (key, value) => {
      data.set(key, value)
      return Promise.resolve()
    },
    remove: (key) => {
      data.delete(key)
      return Promise.resolve()
    },
  }
}

describe('outbox', () => {
  it('queues a transaction once, however many times the same submit is queued', async () => {
    const outbox = createOutbox(null)
    await outbox.add(request('r1'), 1)
    await outbox.add(request('r1'), 2)
    expect(outbox.snapshot()).toHaveLength(1)
    expect(outbox.snapshot()[0]).toMatchObject({ id: 'r1', queuedAt: 1, failure: null })
  })

  it('keeps the queue in memory on the web, and says it is not durable', async () => {
    const outbox = createOutbox(null)
    await outbox.add(request('r1'), 1)
    expect(outbox.durable).toBe(false)
    expect(outbox.snapshot()).toHaveLength(1)
  })

  it('keeps the queue on the device where there is a device store', async () => {
    const store = memoryStore()
    const outbox = createOutbox(store)
    await outbox.add(request('r1'), 1)
    expect(outbox.durable).toBe(true)

    const reopened = createOutbox(store)
    await reopened.ready()
    const [entry] = reopened.snapshot()
    expect(entry?.id).toBe('r1')
    expect(entry?.request.transaction.amount.minor).toBe(48_600n)
  })

  it('removes an entry, and records a failure on one', async () => {
    const outbox = createOutbox(null)
    await outbox.add(request('r1'), 1)
    await outbox.add(request('r2'), 2)
    await outbox.fail('r1', { code: 'fk', message: 'That account no longer exists.' })
    await outbox.remove('r2')
    expect(outbox.snapshot()).toEqual([
      expect.objectContaining({ id: 'r1', failure: { code: 'fk', message: expect.any(String) } }),
    ])
  })

  it('tells subscribers about every change, with a new snapshot each time', async () => {
    const outbox = createOutbox(null)
    const listener = vi.fn()
    outbox.subscribe(listener)
    const before = outbox.snapshot()
    await outbox.add(request('r1'), 1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(outbox.snapshot()).not.toBe(before)
  })

  it('drops anything on the device that is not recognisably an entry', async () => {
    const good = { id: 'r1', queuedAt: 1, request: request('r1'), failure: null }
    const store = memoryStore({
      'mm.outbox.v1': toStoredJson([
        good,
        { id: 'r2', queuedAt: 2 },
        { ...good, id: 'mismatch' },
        'nonsense',
      ]),
    })
    const outbox = createOutbox(store)
    await outbox.ready()
    expect(outbox.snapshot().map((entry) => entry.id)).toEqual(['r1'])
  })

  it('treats an unreadable queue as empty rather than failing to start', async () => {
    const outbox = createOutbox(memoryStore({ 'mm.outbox.v1': '{not json' }))
    await outbox.ready()
    expect(outbox.snapshot()).toEqual([])
  })

  it('keeps an entry added while the saved queue was still being read', async () => {
    const store = memoryStore({
      'mm.outbox.v1': toStoredJson([
        { id: 'saved', queuedAt: 1, request: request('saved'), failure: null },
      ]),
    })
    const outbox = createOutbox(store)
    await outbox.add(request('new'), 2)
    expect(outbox.snapshot().map((entry) => entry.id)).toEqual(['saved', 'new'])
  })
})
