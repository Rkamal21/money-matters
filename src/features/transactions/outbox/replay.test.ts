import { describe, expect, it, vi } from 'vitest'

import type { NewTransaction, Repositories, SplitPart } from '@/data/repositories'
import { fromMinor } from '@/domain/money/Money'
import { of } from '@/domain/period/LocalDate'
import type { Transaction } from '@/domain/transactions/types'
import { AppErrorException, createAppError } from '@/lib/errors'

import type { CreateRequest } from '../services/saveTransaction'

vi.mock('@/platform/storage/deviceStore', () => ({ deviceStore: () => null }))

const { createOutbox } = await import('./outbox')
const { replayOutbox } = await import('./replay')

const offline = () =>
  new AppErrorException(createAppError({ kind: 'network', code: 'net.offline', userMessage: 'x' }))
const refused = () =>
  new AppErrorException(
    createAppError({
      kind: 'validation',
      code: 'fk',
      userMessage: 'That account no longer exists.',
    }),
  )

function request(
  id: string,
  options: { userId?: string; splits?: SplitPart[] } = {},
): CreateRequest {
  return {
    userId: options.userId ?? 'user-a',
    transaction: {
      kind: 'expense',
      amount: fromMinor(100_00n, 'INR'),
      accountId: 'account-1',
      categoryId: 'category-food',
      description: id,
      occurredOn: of(2026, 10, 6),
      clientRequestId: id,
    },
    splits: options.splits ?? null,
  }
}

/** A ledger that, like the database, keeps one row per clientRequestId. */
function ledger() {
  const rows = new Map<string, Transaction>()
  const failures: (() => Error)[] = []
  const transactions = {
    create: vi.fn((_user: string, input: NewTransaction) => {
      const failure = failures.shift()
      if (failure !== undefined) return Promise.reject(failure())
      const existing = rows.get(input.clientRequestId)
      if (existing !== undefined) return Promise.resolve(existing)
      const row = { id: `tx-${rows.size + 1}`, isSplit: false } as Transaction
      rows.set(input.clientRequestId, row)
      return Promise.resolve(row)
    }),
    replaceSplits: vi.fn(() => Promise.resolve()),
  }
  return {
    rows,
    failures,
    transactions,
    deps: { transactions } as unknown as Pick<Repositories, 'transactions'>,
  }
}

describe('replayOutbox', () => {
  it('writes what was queued, oldest first, and empties the queue', async () => {
    const outbox = createOutbox(null)
    await outbox.add(request('first'), 1)
    await outbox.add(request('second'), 2)
    const db = ledger()

    expect(await replayOutbox('user-a', outbox, db.deps)).toEqual({
      added: 2,
      failed: 0,
      waiting: 0,
    })
    expect(db.transactions.create.mock.calls.map(([, input]) => input.clientRequestId)).toEqual([
      'first',
      'second',
    ])
    expect(outbox.snapshot()).toEqual([])
  })

  it('makes one row when the insert had arrived and only the response was lost', async () => {
    const outbox = createOutbox(null)
    const db = ledger()
    // The submit reached the server; the phone never heard back, so it queued.
    db.rows.set('lost-response', { id: 'tx-saved', isSplit: false } as Transaction)
    await outbox.add(request('lost-response'), 1)

    await replayOutbox('user-a', outbox, db.deps)
    await replayOutbox('user-a', outbox, db.deps)
    expect(db.rows.size).toBe(1)
    expect(outbox.snapshot()).toEqual([])
  })

  it('stops while still offline and keeps everything queued', async () => {
    const outbox = createOutbox(null)
    await outbox.add(request('first'), 1)
    await outbox.add(request('second'), 2)
    const db = ledger()
    db.failures.push(offline)

    expect(await replayOutbox('user-a', outbox, db.deps)).toEqual({
      added: 0,
      failed: 0,
      waiting: 2,
    })
    expect(db.transactions.create).toHaveBeenCalledTimes(1)
    expect(outbox.snapshot().map((entry) => entry.failure)).toEqual([null, null])
  })

  it('records a refusal a retry cannot fix, and carries on with the rest', async () => {
    const outbox = createOutbox(null)
    await outbox.add(request('refused'), 1)
    await outbox.add(request('fine'), 2)
    const db = ledger()
    db.failures.push(refused)

    expect(await replayOutbox('user-a', outbox, db.deps)).toEqual({
      added: 1,
      failed: 1,
      waiting: 0,
    })
    expect(outbox.snapshot()).toEqual([
      expect.objectContaining({
        id: 'refused',
        failure: { code: 'fk', message: 'That account no longer exists.' },
      }),
    ])

    // A refused entry is not retried on its own; the person decides.
    await replayOutbox('user-a', outbox, db.deps)
    expect(db.transactions.create).toHaveBeenCalledTimes(2)
  })

  it('only writes the signed-in user’s entries', async () => {
    const outbox = createOutbox(null)
    await outbox.add(request('mine'), 1)
    await outbox.add(request('theirs', { userId: 'user-b' }), 2)
    const db = ledger()

    await replayOutbox('user-a', outbox, db.deps)
    expect(outbox.snapshot().map((entry) => entry.id)).toEqual(['theirs'])
  })

  it('writes the parts of a split, once', async () => {
    const outbox = createOutbox(null)
    const parts = [
      { categoryId: 'food', amount: fromMinor(60_00n, 'INR') },
      { categoryId: 'home', amount: fromMinor(40_00n, 'INR') },
    ]
    await outbox.add(request('split', { splits: parts }), 1)
    const db = ledger()

    await replayOutbox('user-a', outbox, db.deps)
    expect(db.transactions.replaceSplits).toHaveBeenCalledWith('tx-1', parts)
  })
})
