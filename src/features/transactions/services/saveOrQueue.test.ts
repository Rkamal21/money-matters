import { describe, expect, it, vi } from 'vitest'

import type { Repositories } from '@/data/repositories'
import { fromMinor } from '@/domain/money/Money'
import { of } from '@/domain/period/LocalDate'
import type { Transaction } from '@/domain/transactions/types'
import { AppErrorException, createAppError } from '@/lib/errors'

import type { SaveInput } from './saveTransaction'

vi.mock('@/platform/storage/deviceStore', () => ({ deviceStore: () => null }))

const { createOutbox } = await import('../outbox/outbox')
const { saveOrQueue } = await import('./saveOrQueue')

const failure = (kind: 'network' | 'validation') =>
  new AppErrorException(createAppError({ kind, code: kind, userMessage: kind }))

function input(existing: Transaction | null = null): SaveInput {
  return {
    userId: 'user-a',
    existing,
    kind: 'expense',
    amount: fromMinor(250_00n, 'INR'),
    accountId: 'account-1',
    counterAccountId: null,
    categoryId: 'category-food',
    description: 'Lunch',
    notes: null,
    occurredOn: of(2026, 10, 6),
    splits: null,
    clientRequestId: 'request-1',
    suggestion: null,
    categories: [],
  }
}

function repositories(create: () => Promise<Transaction>) {
  return {
    transactions: {
      create: vi.fn(create),
      update: vi.fn(() => Promise.reject(failure('network'))),
    },
    merchantRules: { saveUserRule: vi.fn(() => Promise.resolve()) },
  } as unknown as Pick<Repositories, 'transactions' | 'merchantRules'>
}

describe('saveOrQueue', () => {
  it('saves as usual when the network is there', async () => {
    const outbox = createOutbox(null)
    const saved = { id: 'tx-1', isSplit: false } as Transaction
    const outcome = await saveOrQueue(
      input(),
      repositories(() => Promise.resolve(saved)),
      outbox,
      () => 1,
    )
    expect(outcome).toEqual({ status: 'saved', transaction: saved })
    expect(outbox.snapshot()).toEqual([])
  })

  it('keeps a new transaction in the outbox when the network is down', async () => {
    const outbox = createOutbox(null)
    const outcome = await saveOrQueue(
      input(),
      repositories(() => Promise.reject(failure('network'))),
      outbox,
      () => 42,
    )
    expect(outcome).toEqual({ status: 'queued', durable: false })
    expect(outbox.snapshot()).toEqual([
      expect.objectContaining({
        id: 'request-1',
        queuedAt: 42,
        request: expect.objectContaining({
          userId: 'user-a',
          transaction: expect.objectContaining({
            clientRequestId: 'request-1',
            description: 'Lunch',
          }),
        }),
      }),
    ])
  })

  it('does not queue an edit: replaying it later could overwrite a change made elsewhere', async () => {
    const outbox = createOutbox(null)
    const existing = {
      id: 'tx-1',
      amount: fromMinor(250_00n, 'INR'),
      isSplit: false,
      updatedAt: 't',
      splits: [],
    } as unknown as Transaction
    await expect(
      saveOrQueue(
        input(existing),
        repositories(() => Promise.reject(failure('network'))),
        outbox,
        () => 1,
      ),
    ).rejects.toBeInstanceOf(AppErrorException)
    expect(outbox.snapshot()).toEqual([])
  })

  it('does not queue a refusal: the form shows it, as before', async () => {
    const outbox = createOutbox(null)
    await expect(
      saveOrQueue(
        input(),
        repositories(() => Promise.reject(failure('validation'))),
        outbox,
        () => 1,
      ),
    ).rejects.toBeInstanceOf(AppErrorException)
    expect(outbox.snapshot()).toEqual([])
  })
})
