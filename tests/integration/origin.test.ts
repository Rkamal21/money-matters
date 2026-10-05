import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SupabaseTransactionRepository } from '@/data/repositories/TransactionRepository'
import { fromMinor } from '@/domain/money/Money'
import { fromISO } from '@/domain/period/LocalDate'

import {
  adminClient,
  anonClient,
  createUser,
  deleteUser,
  seedLedger,
  type TestUser,
} from './clients'

/**
 * `record_transaction_origin` (migration 20261004120000): a saved detection's
 * source is recorded once, and an imported message older than its account
 * moves the opening balance with it — in one database transaction, so today's
 * balance never changes and a retry never doubles the shift.
 */

let user: TestUser
let other: TestUser
let ids: Awaited<ReturnType<typeof seedLedger>>
let repo: SupabaseTransactionRepository
let accountCreatedAt: number

async function addExpense(amountMinor: bigint, kind: 'expense' | 'income' = 'expense') {
  return repo.create(user.id, {
    kind,
    amount: fromMinor(amountMinor, 'INR'),
    accountId: ids.bankId,
    counterAccountId: null,
    categoryId: kind === 'expense' ? ids.foodCategoryId : ids.salaryCategoryId,
    description: 'Detected',
    occurredOn: fromISO(ids.today),
    clientRequestId: randomUUID(),
  })
}

async function bank() {
  const account = await adminClient()
    .from('accounts')
    .select('opening_balance_minor')
    .eq('id', ids.bankId)
    .single()
  const balance = await adminClient()
    .from('account_balances')
    .select('balance_minor')
    .eq('account_id', ids.bankId)
    .single()
  if (account.error) throw account.error
  if (balance.error) throw balance.error
  return {
    opening: Number(account.data.opening_balance_minor),
    balance: Number(balance.data.balance_minor),
  }
}

async function sourceOf(id: string) {
  const row = await adminClient().from('transactions').select('source').eq('id', id).single()
  if (row.error) throw row.error
  return row.data.source
}

beforeAll(async () => {
  user = await createUser('origin')
  other = await createUser('origin-other')
  ids = await seedLedger(user)
  repo = new SupabaseTransactionRepository(user.client)
  const account = await adminClient()
    .from('accounts')
    .select('created_at')
    .eq('id', ids.bankId)
    .single()
  if (account.error) throw account.error
  accountCreatedAt = Date.parse(account.data.created_at)
})

afterAll(async () => {
  await deleteUser(user.id)
  await deleteUser(other.id)
})

describe('record_transaction_origin', () => {
  it('records a live SMS once; the balance moves by the payment, the opening balance not at all', async () => {
    const before = await bank()
    const saved = await addExpense(48_600n)

    expect(await repo.recordOrigin(saved.id, 'sms')).toBe(true)
    expect(await sourceOf(saved.id)).toBe('sms')
    expect(await repo.recordOrigin(saved.id, 'sms')).toBe(false)

    const after = await bank()
    expect(after.opening).toBe(before.opening)
    expect(after.balance).toBe(before.balance - 48_600)
  })

  it('absorbs an imported expense sent before the account existed: today’s balance is unchanged', async () => {
    const before = await bank()
    const saved = await addExpense(25_000n)

    expect(await repo.recordOrigin(saved.id, 'import', accountCreatedAt - 86_400_000)).toBe(true)
    const after = await bank()
    expect(await sourceOf(saved.id)).toBe('import')
    expect(after.opening).toBe(before.opening + 25_000)
    expect(after.balance).toBe(before.balance)
  })

  it('absorbs an imported credit the other way', async () => {
    const before = await bank()
    const saved = await addExpense(200_000n, 'income')

    expect(await repo.recordOrigin(saved.id, 'import', accountCreatedAt - 1)).toBe(true)
    const after = await bank()
    expect(after.opening).toBe(before.opening - 200_000)
    expect(after.balance).toBe(before.balance)
  })

  it('shifts the opening balance exactly once, however often it is retried', async () => {
    const saved = await addExpense(10_000n)
    expect(await repo.recordOrigin(saved.id, 'import', accountCreatedAt - 1)).toBe(true)
    const once = await bank()

    expect(await repo.recordOrigin(saved.id, 'import', accountCreatedAt - 1)).toBe(false)
    expect(await bank()).toEqual(once)
  })

  it('leaves the opening balance alone for an imported message sent after the account existed', async () => {
    const before = await bank()
    const saved = await addExpense(7_000n)

    expect(await repo.recordOrigin(saved.id, 'import', Date.now())).toBe(true)
    const after = await bank()
    expect(after.opening).toBe(before.opening)
    expect(after.balance).toBe(before.balance - 7_000)
  })

  it('answers false for someone else’s transaction, and changes nothing', async () => {
    const saved = await addExpense(3_000n)
    const before = await bank()
    const otherRepo = new SupabaseTransactionRepository(other.client)

    expect(await otherRepo.recordOrigin(saved.id, 'import', accountCreatedAt - 1)).toBe(false)
    expect(await sourceOf(saved.id)).toBe('manual')
    expect(await bank()).toEqual(before)
  })

  it('answers false for a deleted transaction', async () => {
    const saved = await addExpense(2_000n)
    await repo.softDelete(saved.id)

    expect(await repo.recordOrigin(saved.id, 'sms')).toBe(false)
    expect(await sourceOf(saved.id)).toBe('manual')
  })

  it('refuses a source that is not a detection', async () => {
    const saved = await addExpense(1_000n)
    const { error } = await user.client.rpc('record_transaction_origin', {
      p_transaction_id: saved.id,
      p_source: 'manual',
    })
    expect(error?.code).toBe('22023')
  })

  it('is not callable without signing in', async () => {
    const { error } = await anonClient().rpc('record_transaction_origin', {
      p_transaction_id: randomUUID(),
      p_source: 'sms',
    })
    expect(error).not.toBeNull()
  })
})
