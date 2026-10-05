import { describe, expect, it, vi } from 'vitest'

import type { NewTransaction, Repositories } from '@/data/repositories'
import { of } from '@/domain/period/LocalDate'
import { confirmationRequestId } from '@/domain/transactions/ingest/review'
import type { Transaction } from '@/domain/transactions/types'
import type { Detection, DetectionSource } from '@/platform/sms/smsCapture'
import {
  ACCOUNTS,
  BANK,
  candidateOf,
  CATEGORIES,
  categoryId,
  MESSAGES,
  RULES,
  SAVINGS,
  USER_ID,
  uuid,
} from '@tests/fixtures/detection'

import { autoAddDetections, exclusively, undoDetection } from './autoAdd'

/**
 * The automatic pass against in-memory repositories and a fake device queue:
 * what it writes, what it holds, and what it leaves for the next pass.
 */

const TODAY = of(2026, 10, 5)
const PERSON =
  'Dear UPI user A/C X1234 debited by 150.00 on date 03Oct26 trf to Amit Refno 900000000402'

function detection(
  text: string,
  overrides: Partial<Omit<Detection, 'candidate'>> & { source?: DetectionSource } = {},
): Detection {
  const candidate = candidateOf(text)
  return {
    id: `d-${candidate.fingerprint.value.slice(0, 8)}`,
    receivedAt: 1_000,
    sentAt: 900,
    source: 'sms',
    auto: true,
    requestId: confirmationRequestId(candidate.fingerprint),
    candidate,
    ...overrides,
  }
}

function fakes(pending: Detection[], ledger: Transaction[] = []) {
  const rows = [...ledger]
  const transactions = {
    findByClientRequestId: vi.fn((_user: string, key: string) =>
      Promise.resolve(rows.find((row) => requestIds.get(row.id) === key) ?? null),
    ),
    list: vi.fn(() => Promise.resolve({ items: rows, nextCursor: null })),
    create: vi.fn((_user: string, input: NewTransaction) => {
      const row: Transaction = {
        id: uuid(700 + rows.length),
        kind: input.kind,
        amount: input.amount,
        accountId: input.accountId,
        counterAccountId: input.counterAccountId ?? null,
        categoryId: input.categoryId ?? null,
        merchantLabel: input.merchantLabel ?? null,
        description: input.description ?? '',
        notes: input.notes ?? null,
        occurredOn: input.occurredOn,
        isSplit: false,
        splits: [],
        refundOfTransactionId: null,
        createdAt: '2026-10-05T10:00:00Z',
        updatedAt: '2026-10-05T10:00:00Z',
        deletedAt: null,
      }
      rows.push(row)
      requestIds.set(row.id, input.clientRequestId)
      return Promise.resolve(row)
    }),
    recordOrigin: vi.fn(() => Promise.resolve(true)),
    softDelete: vi.fn(() => Promise.resolve()),
  }
  const requestIds = new Map<string, string>()
  const capture = {
    listPending: vi.fn(() => Promise.resolve(pending)),
    settle: vi.fn(() => Promise.resolve()),
    hold: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
  }
  const merchantRules = { saveUserRule: vi.fn(() => Promise.resolve()) }
  const repositories = { transactions, merchantRules } as unknown as Pick<
    Repositories,
    'transactions' | 'merchantRules'
  >
  return { rows, requestIds, transactions, capture, repositories }
}

const INPUT = {
  userId: USER_ID,
  accounts: ACCOUNTS,
  categories: CATEGORIES,
  rules: RULES,
  today: TODAY,
  currency: 'INR',
  enabled: true,
}

function row(overrides: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    kind: 'expense',
    amount: candidateOf(MESSAGES.expense).amount,
    accountId: BANK.id,
    counterAccountId: null,
    categoryId: categoryId('food'),
    merchantLabel: null,
    description: 'Swiggy dinner',
    notes: null,
    occurredOn: of(2026, 10, 3),
    isSplit: false,
    splits: [],
    refundOfTransactionId: null,
    createdAt: '2026-10-03T10:00:00Z',
    updatedAt: '2026-10-03T10:00:00Z',
    deletedAt: null,
    ...overrides,
  }
}

describe('autoAddDetections', () => {
  it('adds a clear SMS through saveTransaction, records it as SMS, and words its notification', async () => {
    const swiggy = detection(MESSAGES.expense)
    const f = fakes([swiggy])

    const result = await autoAddDetections(INPUT, {
      repositories: f.repositories,
      capture: f.capture,
    })

    expect(result.added).toHaveLength(1)
    expect(f.transactions.create).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        kind: 'expense',
        accountId: BANK.id,
        categoryId: categoryId('food'),
        description: 'Swiggy',
        clientRequestId: swiggy.requestId,
      }),
    )
    expect(f.rows[0]?.amount.minor).toBe(48_600n)
    expect(f.transactions.recordOrigin).toHaveBeenCalledWith(f.rows[0]?.id, 'sms', null)
    expect(f.capture.settle).toHaveBeenCalledWith(swiggy.id, {
      requestId: swiggy.requestId,
      notice: expect.objectContaining({
        title: 'Transaction added',
        text: 'Money Matters added a ₹486 payment at Swiggy to Food.',
      }),
    })
  })

  it('holds a payee with no category rule, rewording a notification that said "added"', async () => {
    const amit = detection(PERSON)
    const f = fakes([amit])

    const result = await autoAddDetections(INPUT, {
      repositories: f.repositories,
      capture: f.capture,
    })

    expect(result.held).toEqual([{ detection: amit, reasons: ['no_category'] }])
    expect(f.transactions.create).not.toHaveBeenCalled()
    expect(f.capture.hold).toHaveBeenCalledWith(
      amit.id,
      expect.objectContaining({ title: 'Transaction detected' }),
    )
    expect(f.capture.settle).not.toHaveBeenCalled()
  })

  it('does not reword a held detection Android already left for review', async () => {
    const amit = detection(PERSON, { auto: false })
    const f = fakes([amit])
    await autoAddDetections(INPUT, { repositories: f.repositories, capture: f.capture })
    expect(f.capture.hold).not.toHaveBeenCalled()
  })

  it('holds a payment when something like it is already in the ledger — a typed entry', async () => {
    const f = fakes([detection(MESSAGES.expense)], [row({ id: uuid(800) })])

    const result = await autoAddDetections(INPUT, {
      repositories: f.repositories,
      capture: f.capture,
    })

    expect(result.held[0]?.reasons).toEqual(['similar_exists'])
    expect(f.transactions.create).not.toHaveBeenCalled()
  })

  it('holds the second half of a transfer between the user’s own accounts', async () => {
    const credit = detection(
      'Rs 25,000 credited to A/c XX1234 on 03-10-26 by NEFT from ACME PAYROLL',
    )
    const debit = row({
      id: uuid(801),
      accountId: SAVINGS.id,
      amount: credit.candidate.amount,
      categoryId: null,
    })
    const f = fakes([credit], [debit])

    const result = await autoAddDetections(INPUT, {
      repositories: f.repositories,
      capture: f.capture,
    })

    expect(result.held[0]?.reasons).toEqual(['possible_transfer'])
  })

  it('adds nothing when the user turned it off', async () => {
    const f = fakes([detection(MESSAGES.expense)])
    const result = await autoAddDetections(
      { ...INPUT, enabled: false },
      { repositories: f.repositories, capture: f.capture },
    )
    expect(result.held[0]?.reasons).toEqual(['off'])
    expect(f.transactions.create).not.toHaveBeenCalled()
  })

  it('finishes quietly a detection already in the ledger — recording its origin, writing no row', async () => {
    const swiggy = detection(MESSAGES.expense)
    const saved = row({ id: uuid(802) })
    const f = fakes([swiggy], [saved])
    f.requestIds.set(saved.id, swiggy.requestId)

    const result = await autoAddDetections(INPUT, {
      repositories: f.repositories,
      capture: f.capture,
    })

    expect(result.alreadyAdded).toEqual([swiggy])
    expect(f.transactions.create).not.toHaveBeenCalled()
    expect(f.transactions.recordOrigin).toHaveBeenCalledWith(saved.id, 'sms', null)
    expect(f.capture.settle).toHaveBeenCalledWith(swiggy.id, null)
  })

  it('never brings back a detection whose row the user deleted', async () => {
    const swiggy = detection(MESSAGES.expense)
    const deleted = row({ id: uuid(803), deletedAt: '2026-10-04T10:00:00Z' })
    const f = fakes([swiggy], [deleted])
    f.requestIds.set(deleted.id, swiggy.requestId)

    await autoAddDetections(INPUT, { repositories: f.repositories, capture: f.capture })

    expect(f.transactions.create).not.toHaveBeenCalled()
    expect(f.transactions.recordOrigin).not.toHaveBeenCalled()
    expect(f.capture.settle).toHaveBeenCalledWith(swiggy.id, null)
  })

  it('records an imported message with its send time, and settles it without a notification', async () => {
    const imported = detection(MESSAGES.expense, { source: 'import', sentAt: 123_456, auto: false })
    const f = fakes([imported])

    await autoAddDetections(INPUT, { repositories: f.repositories, capture: f.capture })

    expect(f.transactions.recordOrigin).toHaveBeenCalledWith(f.rows[0]?.id, 'import', 123_456)
    expect(f.capture.settle).toHaveBeenCalledWith(imported.id, null)
  })

  it('keeps a detection queued when writing fails, for the next pass', async () => {
    const swiggy = detection(MESSAGES.expense)
    const f = fakes([swiggy])
    f.transactions.recordOrigin.mockRejectedValueOnce(new Error('offline'))

    const result = await autoAddDetections(INPUT, {
      repositories: f.repositories,
      capture: f.capture,
    })

    expect(result.failed).toEqual([swiggy])
    expect(f.capture.settle).not.toHaveBeenCalled()
  })

  it('works oldest first', async () => {
    const newer = detection(MESSAGES.expense, { receivedAt: 2_000 })
    const older = detection(MESSAGES.income, { receivedAt: 1_000 })
    const f = fakes([newer, older]) // listPending answers newest first

    await autoAddDetections(INPUT, { repositories: f.repositories, capture: f.capture })

    expect(f.transactions.create.mock.calls.map(([, input]) => input.kind)).toEqual([
      'income',
      'expense',
    ])
  })
})

describe('undoDetection', () => {
  it('deletes the row an Undo is for, and drops the detection', async () => {
    const swiggy = detection(MESSAGES.expense)
    const saved = row({ id: uuid(804) })
    const f = fakes([], [saved])
    f.requestIds.set(saved.id, swiggy.requestId)

    const { removed } = await undoDetection(
      { id: swiggy.id, requestId: swiggy.requestId },
      USER_ID,
      { repositories: f.repositories, capture: f.capture },
    )

    expect(removed).toBe(saved)
    expect(f.transactions.softDelete).toHaveBeenCalledWith(saved.id)
    expect(f.capture.remove).toHaveBeenCalledWith(swiggy.id)
  })

  it('only drops the detection when it was not added yet', async () => {
    const f = fakes([])
    const { removed } = await undoDetection({ id: 'd1', requestId: uuid(900) }, USER_ID, {
      repositories: f.repositories,
      capture: f.capture,
    })
    expect(removed).toBeNull()
    expect(f.transactions.softDelete).not.toHaveBeenCalled()
    expect(f.capture.remove).toHaveBeenCalledWith('d1')
  })
})

describe('exclusively', () => {
  it('never lets two passes overlap', async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const first = exclusively(
      () =>
        new Promise<void>((resolve) => {
          order.push('first:start')
          release = () => {
            order.push('first:end')
            resolve()
          }
        }),
    )
    const second = exclusively(() => {
      order.push('second')
      return Promise.resolve()
    })
    await Promise.resolve()
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })
})
