import { randomUUID } from 'node:crypto'

import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { calculateAvailable } from '@/domain/budget/calculateSafeDailyLimit'
import { fromMinor, subtract, zero } from '@/domain/money/Money'
import { netVariable } from '@/domain/transactions/PeriodSummary'

import { adminClient, createUser, deleteUser, seedLedger, type TestUser } from './clients'
import { connect } from './db'

/**
 * The ledger's invariants, as the database enforces them — TESTING.md §4.2
 * and §4.3. Each test runs as a real signed-in user through PostgREST.
 */

let user: TestUser
let ids: Awaited<ReturnType<typeof seedLedger>>
let sql: postgres.Sql
let savingsId: string

const inr = (minor: bigint) => fromMinor(minor, 'INR')

function tx(overrides: Record<string, unknown> = {}) {
  return {
    user_id: user.id,
    account_id: ids.bankId,
    kind: 'expense',
    amount_minor: 10_000,
    category_id: ids.foodCategoryId,
    occurred_on: ids.today,
    client_request_id: randomUUID(),
    ...overrides,
  }
}

async function balance(accountId: string): Promise<number> {
  const { data, error } = await user.client
    .from('account_balances')
    .select('balance_minor')
    .eq('account_id', accountId)
    .single()
  if (error) throw error
  return data.balance_minor
}

function monthBounds(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number]
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: next }
}

beforeAll(async () => {
  sql = connect()
  user = await createUser('ledger')
  ids = await seedLedger(user)
  const savings = await user.client
    .from('accounts')
    .insert({ user_id: user.id, name: 'Savings', type: 'savings' })
    .select('id')
    .single()
  if (savings.error) throw savings.error
  savingsId = savings.data.id
}, 60_000)

afterAll(async () => {
  if (user) await deleteUser(user.id)
  await sql.end({ timeout: 5 })
})

describe('the transfer test (ROADMAP.md M2)', () => {
  it('₹10,000 Bank → Savings is neither income nor expense, and both balances move', async () => {
    const bankBefore = await balance(ids.bankId)
    const savingsBefore = await balance(savingsId)
    const bounds = monthBounds(ids.today)
    const before = await user.client.rpc('get_period_summary', {
      p_from: bounds.from,
      p_to: bounds.to,
    })

    const { error } = await user.client.from('transactions').insert(
      tx({
        kind: 'transfer',
        amount_minor: 1_000_000,
        category_id: null,
        counter_account_id: savingsId,
      }),
    )
    expect(error).toBeNull()

    expect(await balance(ids.bankId)).toBe(bankBefore - 1_000_000)
    expect(await balance(savingsId)).toBe(savingsBefore + 1_000_000)

    const after = await user.client.rpc('get_period_summary', {
      p_from: bounds.from,
      p_to: bounds.to,
    })
    const [b, a] = [before.data[0], after.data[0]]
    expect(a.income_minor).toBe(b.income_minor)
    expect(a.expense_minor).toBe(b.expense_minor)
    expect(a.transfer_in_minor).toBe(b.transfer_in_minor + 1_000_000)
  })
})

describe('shape constraints', () => {
  it.each([
    ['a zero amount', { amount_minor: 0 }, '23514'],
    ['a negative amount', { amount_minor: -500 }, '23514'],
    ['a transfer with a category', { kind: 'transfer', counter_account_id: 'SAVINGS' }, '23514'],
    [
      'a transfer to itself',
      { kind: 'transfer', category_id: null, counter_account_id: 'BANK' },
      '23514',
    ],
    ['an expense with a counter account', { counter_account_id: 'SAVINGS' }, '23514'],
    ['a date before 2000', { occurred_on: '1999-12-31' }, '23514'],
    ['a date six years ahead', { occurred_on: '2099-01-01' }, '23514'],
    ['an income filed under an expense category', { kind: 'income' }, '23514'],
  ])('refuses %s', async (_label, overrides, code) => {
    const resolved = Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [
        key,
        value === 'SAVINGS' ? savingsId : value === 'BANK' ? ids.bankId : value,
      ]),
    )
    const { error } = await user.client.from('transactions').insert(tx(resolved))
    expect(error?.code).toBe(code)
  })
})

describe('idempotency (DATABASE.md §12)', () => {
  it('the same client_request_id twice is one row', async () => {
    const requestId = randomUUID()
    const first = await user.client
      .from('transactions')
      .insert(tx({ client_request_id: requestId }))
    const second = await user.client
      .from('transactions')
      .insert(tx({ client_request_id: requestId }))
    expect(first.error).toBeNull()
    expect(second.error?.code).toBe('23505')
    const { count } = await user.client
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('client_request_id', requestId)
    expect(count).toBe(1)
  })

  it('an edit against a stale updated_at changes nothing', async () => {
    const created = await user.client
      .from('transactions')
      .insert(tx())
      .select('id, updated_at')
      .single()
    const row = created.data as { id: string; updated_at: string }
    await user.client.from('transactions').update({ description: 'first edit' }).eq('id', row.id)
    const stale = await user.client
      .from('transactions')
      .update({ description: 'second edit' })
      .eq('id', row.id)
      .eq('updated_at', row.updated_at)
      .select()
    expect(stale.data).toEqual([])
  })
})

describe('splits (DATABASE.md §6.5)', () => {
  it('parts that sum to the whole commit, mark the parent split and feed category totals', async () => {
    const created = await user.client
      .from('transactions')
      .insert(tx({ amount_minor: 320_000 }))
      .select('id')
      .single()
    const id = (created.data as { id: string }).id
    const { error } = await user.client.rpc('replace_transaction_splits', {
      p_transaction_id: id,
      p_splits: [
        { category_id: ids.foodCategoryId, amount_minor: 260_000 },
        { category_id: await categoryId('personal'), amount_minor: 60_000 },
      ],
    })
    expect(error).toBeNull()
    const row = await user.client
      .from('transactions')
      .select('is_split, category_id')
      .eq('id', id)
      .single()
    expect(row.data).toEqual({ is_split: true, category_id: null })
    const amounts = await user.client
      .from('transaction_category_amounts')
      .select('amount_minor')
      .eq('transaction_id', id)
    expect(
      (amounts.data as { amount_minor: number }[]).reduce((sum, r) => sum + r.amount_minor, 0),
    ).toBe(320_000)
  })

  it('parts that do not sum to the whole are refused at commit', async () => {
    const created = await user.client
      .from('transactions')
      .insert(tx({ amount_minor: 100_000 }))
      .select('id')
      .single()
    const id = (created.data as { id: string }).id
    const { error } = await user.client.rpc('replace_transaction_splits', {
      p_transaction_id: id,
      p_splits: [
        { category_id: ids.foodCategoryId, amount_minor: 50_000 },
        { category_id: await categoryId('personal'), amount_minor: 40_000 },
      ],
    })
    expect(error?.code).toBe('23514')
    const row = await user.client.from('transactions').select('is_split').eq('id', id).single()
    expect(row.data).toEqual({ is_split: false })
  })
})

async function categoryId(slug: string): Promise<string> {
  const { data } = await user.client.from('categories').select('id').eq('slug', slug).single()
  return (data as { id: string }).id
}

describe('budget periods (ROADMAP.md M4)', () => {
  it('ensure_budget_period called concurrently creates exactly one period', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        user.client.rpc('ensure_budget_period', { p_today: ids.today }),
      ),
    )
    const periodIds = new Set(results.map((result) => (result.data as { id: string }).id))
    expect(periodIds.size).toBe(1)
  })

  it('refuses a p_today far from the server date', async () => {
    const { error } = await user.client.rpc('ensure_budget_period', { p_today: '2030-01-01' })
    expect(error?.code).toBe('22007')
  })

  it('a closed period can be read but not edited', async () => {
    await sql`update public.budget_periods set closed_at = now() where id = ${ids.periodId}`
    const read = await user.client.from('budget_periods').select('id').eq('id', ids.periodId)
    expect(read.data).toHaveLength(1)
    const write = await user.client
      .from('budget_periods')
      .update({ expected_income_minor: 1 })
      .eq('id', ids.periodId)
      .select()
    expect(write.data).toEqual([])
    await sql`update public.budget_periods set closed_at = null where id = ${ids.periodId}`
  })

  it('SQL rollover and the TypeScript engine agree on what is left of a period', async () => {
    const period = await user.client
      .from('budget_periods')
      .select('*')
      .eq('id', ids.periodId)
      .single()
    const plan = period.data as {
      period: string
      expected_income_minor: number
      planned_fixed_minor: number
      planned_savings_minor: number
      rollover_in_minor: number
      overall_limit_minor: number | null
    }
    await user.client
      .from('budget_periods')
      .update({
        expected_income_minor: 6_000_000,
        planned_fixed_minor: 2_000_000,
        planned_savings_minor: 500_000,
      })
      .eq('id', ids.periodId)

    const [, from, to] = /^\[(.+),(.+)\)$/.exec(plan.period) ?? []
    const summary = await user.client.rpc('get_period_summary', { p_from: from, p_to: to })
    const s = summary.data[0]
    const rows = await sql<
      { remaining: string }[]
    >`select public.period_remaining_minor(${ids.periodId}::uuid)::text as remaining`
    const remaining = rows[0]?.remaining

    const available = calculateAvailable({
      plan: {
        expectedIncome: inr(6_000_000n),
        plannedFixed: inr(2_000_000n),
        plannedSavings: inr(500_000n),
        rolloverIn: inr(BigInt(plan.rollover_in_minor)),
        overallLimit: null,
      },
      actuals: {
        incomeReceived: inr(BigInt(s.income_minor)),
        fixedPaid: inr(BigInt(Math.max(0, s.fixed_minor - s.fixed_refund_minor))),
        variableSpent: inr(BigInt(s.variable_minor)),
        refundsAgainstVariable: inr(BigInt(s.variable_refund_minor)),
      },
      upcomingPlanned: zero('INR'),
    }).available
    const netVar = netVariable({
      income: inr(0n),
      expense: inr(0n),
      refund: inr(0n),
      fixed: inr(0n),
      fixedRefund: inr(0n),
      variable: inr(BigInt(s.variable_minor)),
      variableRefund: inr(BigInt(s.variable_refund_minor)),
      excluded: inr(0n),
      excludedRefund: inr(0n),
      transfers: inr(0n),
      transactionCount: 0,
      byCategory: [],
    })
    expect(BigInt(remaining ?? '0')).toBe(subtract(available, netVar).minor)
  })
})

describe('goals over wallets (ROADMAP.md M6)', () => {
  it('progress equals the wallet balance through transfers in, out, edits and deletes', async () => {
    const into = await user.client
      .from('transactions')
      .insert(
        tx({
          kind: 'transfer',
          category_id: null,
          counter_account_id: ids.walletId,
          amount_minor: 200_000,
        }),
      )
      .select('id')
      .single()
    await user.client.from('transactions').insert(
      tx({
        kind: 'transfer',
        category_id: null,
        account_id: ids.walletId,
        counter_account_id: ids.bankId,
        amount_minor: 50_000,
      }),
    )
    await user.client
      .from('transactions')
      .update({ amount_minor: 300_000 })
      .eq('id', (into.data as { id: string }).id)

    const progress = await user.client
      .from('goal_progress')
      .select('balance_minor')
      .eq('goal_id', ids.goalId)
      .single()
    expect((progress.data as { balance_minor: number }).balance_minor).toBe(
      await balance(ids.walletId),
    )
    expect(await balance(ids.walletId)).toBe(250_000)
  })

  it('20 concurrent transfers into one wallet produce an exact balance', async () => {
    const before = await balance(ids.walletId)
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        user.client.from('transactions').insert(
          tx({
            kind: 'transfer',
            category_id: null,
            counter_account_id: ids.walletId,
            amount_minor: 1_111,
          }),
        ),
      ),
    )
    expect(results.every((result) => result.error === null)).toBe(true)
    expect(await balance(ids.walletId)).toBe(before + 20 * 1_111)
  })

  it('reached is sticky: spending the money on its purpose does not un-achieve the goal', async () => {
    const wallet = await user.client
      .from('accounts')
      .insert({ user_id: user.id, name: `Trip ${randomUUID().slice(0, 6)}`, type: 'wallet' })
      .select('id')
      .single()
    const walletId = (wallet.data as { id: string }).id
    const goal = await user.client
      .from('goals')
      .insert({
        user_id: user.id,
        wallet_account_id: walletId,
        name: 'Trip',
        target_minor: 100_000,
      })
      .select('id')
      .single()
    const goalId = (goal.data as { id: string }).id

    // Reached is judged on end-of-day balances (DATABASE.md §8 groups by
    // occurred_on), so the purchase lands the day after the target is met.
    const [y, m, d] = ids.today.split('-').map(Number) as [number, number, number]
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
    await user.client.from('transactions').insert(
      tx({
        kind: 'transfer',
        category_id: null,
        counter_account_id: walletId,
        amount_minor: 100_000,
      }),
    )
    await user.client.from('transactions').insert(
      tx({
        account_id: walletId,
        amount_minor: 90_000,
        category_id: await categoryId('travel'),
        occurred_on: tomorrow,
      }),
    )

    const progress = await user.client
      .from('goal_progress')
      .select('balance_minor, reached, reached_on')
      .eq('goal_id', goalId)
      .single()
    expect(progress.data).toMatchObject({
      balance_minor: 10_000,
      reached: true,
      reached_on: ids.today,
    })
  })
})

describe('gamification is server-authoritative (ADR-0016)', () => {
  it('awards XP for logging, capped at five a day', async () => {
    const fresh = await createUser('xp-cap')
    try {
      const seeded = await seedLedger(fresh)
      for (let i = 0; i < 7; i += 1) {
        await fresh.client.from('transactions').insert({
          user_id: fresh.id,
          account_id: seeded.bankId,
          kind: 'expense',
          amount_minor: 100 + i,
          category_id: seeded.foodCategoryId,
          occurred_on: seeded.today,
          client_request_id: randomUUID(),
        })
      }
      const { count } = await fresh.client
        .from('gamification_events')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'transaction_logged')
      expect(count).toBe(5)
      const events = await fresh.client.from('gamification_events').select('xp_awarded')
      const profile = await fresh.client.from('gamification_profiles').select('xp_total').single()
      const sum = (events.data as { xp_awarded: number }[]).reduce(
        (total, row) => total + row.xp_awarded,
        0,
      )
      expect((profile.data as { xp_total: number }).xp_total).toBe(sum)
    } finally {
      await deleteUser(fresh.id)
    }
  })

  it('checking in twice in a day awards once and changes the streak once', async () => {
    const first = await user.client.rpc('daily_check_in', { p_today: ids.today })
    const second = await user.client.rpc('daily_check_in', { p_today: ids.today })
    expect(first.error).toBeNull()
    expect((second.data as { current_streak: number }).current_streak).toBe(
      (first.data as { current_streak: number }).current_streak,
    )
    const { count } = await user.client
      .from('gamification_events')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'daily_check_in')
    expect(count).toBe(1)
  })

  it('refuses a check-in dated far from the server date', async () => {
    const { error } = await user.client.rpc('daily_check_in', { p_today: '2031-05-05' })
    expect(error?.code).toBe('22007')
  })

  it('opting out stops the awards server-side', async () => {
    const quiet = await createUser('xp-optout')
    try {
      const seeded = await seedLedger(quiet)
      await quiet.client.from('profiles').update({ gamification_enabled: false }).eq('id', quiet.id)
      const before = await quiet.client.from('gamification_profiles').select('xp_total').single()
      await quiet.client.from('transactions').insert({
        user_id: quiet.id,
        account_id: seeded.bankId,
        kind: 'expense',
        amount_minor: 999,
        category_id: seeded.foodCategoryId,
        occurred_on: seeded.today,
        client_request_id: randomUUID(),
      })
      const after = await quiet.client.from('gamification_profiles').select('xp_total').single()
      expect(after.data).toEqual(before.data)
    } finally {
      await deleteUser(quiet.id)
    }
  })
})

describe('account deletion (SECURITY.md §3)', () => {
  it('delete_my_account removes the auth user and every row', async () => {
    const leaving = await createUser('leaving')
    await seedLedger(leaving)
    const { error } = await leaving.client.rpc('delete_my_account')
    expect(error).toBeNull()

    const admin = adminClient()
    for (const table of [
      'profiles',
      'accounts',
      'categories',
      'transactions',
      'goals',
      'budget_periods',
      'gamification_profiles',
      'audit_log',
    ]) {
      const column = table === 'profiles' ? 'id' : 'user_id'
      const { count } = await admin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq(column, leaving.id)
      expect(count, table).toBe(0)
    }
    const auth = await admin.auth.admin.getUserById(leaving.id)
    expect(auth.data.user).toBeNull()
  })

  it('a system category cannot be deleted directly', async () => {
    const { error } = await user.client
      .from('categories')
      .delete()
      .eq('id', await categoryId('other'))
    expect(error?.code).toBe('23514')
  })
})

describe('the signup trigger (ROADMAP.md M1)', () => {
  it('creates a profile, a gamification profile and twelve categories', async () => {
    const fresh = await createUser('signup')
    try {
      const profile = await fresh.client.from('profiles').select('display_name, timezone').single()
      expect(profile.data).toEqual({ display_name: 'signup', timezone: 'Asia/Kolkata' })
      const { count } = await fresh.client
        .from('categories')
        .select('id', { count: 'exact', head: true })
      expect(count).toBe(12)
      const game = await fresh.client.from('gamification_profiles').select('xp_total').single()
      expect(game.data).toEqual({ xp_total: 0 })
    } finally {
      await deleteUser(fresh.id)
    }
  })
})
