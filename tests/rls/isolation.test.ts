import { randomUUID } from 'node:crypto'

import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  adminClient,
  anonClient,
  createUser,
  deleteUser,
  seedLedger,
  type TestUser,
} from '../integration/clients'
import { connect } from '../integration/db'

/**
 * The RLS isolation matrix — SECURITY.md §8.1, TESTING.md §4.1.
 *
 * Two real users, A and B, each with one of everything. For every user-owned
 * table and every command, A must not reach B's row. The table list is checked
 * against the live schema, so a new table nobody wrote a policy for fails this
 * suite — the failure mode that matters most.
 */

let a: TestUser
let b: TestUser
let aIds: Awaited<ReturnType<typeof seedLedger>>
let bIds: Awaited<ReturnType<typeof seedLedger>>
let sql: postgres.Sql

/** Every table in `public`, and the row of B's that A will aim at. */
const MATRIX: Record<string, { column: string; id: () => string }> = {
  profiles: { column: 'id', id: () => b.id },
  accounts: { column: 'id', id: () => bIds.bankId },
  categories: { column: 'id', id: () => bIds.foodCategoryId },
  transactions: { column: 'id', id: () => bIds.transactionId },
  transaction_splits: { column: 'transaction_id', id: () => bIds.transactionId },
  budget_periods: { column: 'id', id: () => bIds.periodId },
  budget_category_limits: { column: 'id', id: () => bIds.limitId },
  goals: { column: 'id', id: () => bIds.goalId },
  gamification_profiles: { column: 'user_id', id: () => b.id },
  gamification_events: { column: 'user_id', id: () => b.id },
  user_achievements: { column: 'user_id', id: () => b.id },
  merchant_rules: { column: 'id', id: () => bIds.ruleId },
  audit_log: { column: 'user_id', id: () => b.id },
  achievements: { column: 'code', id: () => 'first_transaction' },
}

beforeAll(async () => {
  sql = connect()
  ;[a, b] = await Promise.all([createUser('rls-a'), createUser('rls-b')])
  ;[aIds, bIds] = await Promise.all([seedLedger(a), seedLedger(b)])
}, 60_000)

afterAll(async () => {
  await Promise.all([a && deleteUser(a.id), b && deleteUser(b.id)])
  await sql.end({ timeout: 5 })
})

describe('the matrix covers every table', () => {
  it('lists exactly the tables in public', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1
    `
    expect(rows.map((row) => row.relname)).toEqual(Object.keys(MATRIX).sort())
  })
})

describe('A cannot read B', () => {
  it.each(Object.keys(MATRIX).filter((table) => table !== 'achievements'))(
    '%s: selecting B’s row returns nothing',
    async (table) => {
      const target = MATRIX[table]
      if (!target) throw new Error(table)
      const { data, error } = await a.client.from(table).select('*').eq(target.column, target.id())
      expect(error).toBeNull()
      expect(data).toEqual([])
    },
  )

  it('B can read their own rows (the positive control)', async () => {
    const { data } = await b.client.from('transactions').select('id').eq('id', bIds.transactionId)
    expect(data).toHaveLength(1)
  })

  it('the achievements catalog is readable by everyone signed in', async () => {
    const { data } = await a.client.from('achievements').select('code')
    expect(data?.length).toBeGreaterThanOrEqual(10)
  })

  it('system merchant rules are shared; B’s own rules are not', async () => {
    const { data } = await a.client.from('merchant_rules').select('user_id')
    const owners = new Set((data ?? []).map((row: { user_id: string | null }) => row.user_id))
    expect(owners.has(null)).toBe(true)
    expect(owners.has(b.id)).toBe(false)
  })
})

describe('A cannot change or delete B', () => {
  const writable = [
    'accounts',
    'categories',
    'transactions',
    'budget_periods',
    'budget_category_limits',
    'goals',
    'merchant_rules',
  ]

  it.each(writable)('%s: updating B’s row affects nothing', async (table) => {
    const target = MATRIX[table]
    if (!target) throw new Error(table)
    const patch =
      table === 'budget_periods'
        ? { expected_income_minor: 1 }
        : table === 'budget_category_limits'
          ? { limit_minor: 1 }
          : table === 'transactions'
            ? { description: 'pwned' }
            : table === 'merchant_rules'
              ? { merchant_label: 'pwned' }
              : { name: 'pwned' }
    const { data, error } = await a.client
      .from(table)
      .update(patch)
      .eq(target.column, target.id())
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it.each(writable)('%s: deleting B’s row affects nothing', async (table) => {
    const target = MATRIX[table]
    if (!target) throw new Error(table)
    await a.client.from(table).delete().eq(target.column, target.id())
    const { data } = await adminClient()
      .from(table)
      .select(target.column)
      .eq(target.column, target.id())
    expect(data?.length).toBeGreaterThan(0)
  })

  it('profiles: updating B’s profile affects nothing', async () => {
    const { data } = await a.client
      .from('profiles')
      .update({ display_name: 'pwned' })
      .eq('id', b.id)
      .select()
    expect(data).toEqual([])
  })
})

describe('A cannot write rows owned by B, or point at B’s rows', () => {
  it('inserting a transaction with user_id = B is refused', async () => {
    const { error } = await a.client.from('transactions').insert({
      user_id: b.id,
      account_id: bIds.bankId,
      kind: 'expense',
      amount_minor: 100,
      category_id: bIds.foodCategoryId,
      occurred_on: aIds.today,
    })
    expect(error?.code).toBe('42501')
  })

  it('moving A’s own row into B’s tenant is refused (WITH CHECK)', async () => {
    const { error } = await a.client
      .from('accounts')
      .update({ user_id: b.id })
      .eq('id', aIds.bankId)
    // user_id is not even in the UPDATE grant.
    expect(error?.code).toBe('42501')
  })

  it('a transaction on B’s account is a foreign-key violation (composite FK)', async () => {
    const { error } = await a.client.from('transactions').insert({
      user_id: a.id,
      account_id: bIds.bankId,
      kind: 'expense',
      amount_minor: 100,
      category_id: aIds.foodCategoryId,
      occurred_on: aIds.today,
    })
    expect(error?.code).toBe('23503')
  })

  it('a transaction filed under B’s category is a foreign-key violation', async () => {
    const { error } = await a.client.from('transactions').insert({
      user_id: a.id,
      account_id: aIds.bankId,
      kind: 'expense',
      amount_minor: 100,
      category_id: bIds.foodCategoryId,
      occurred_on: aIds.today,
    })
    expect(error?.code).toBe('23503')
  })

  it('a limit in B’s budget period is refused', async () => {
    const { error } = await a.client.from('budget_category_limits').insert({
      user_id: a.id,
      budget_period_id: bIds.periodId,
      category_id: aIds.foodCategoryId,
      limit_minor: 100,
    })
    expect(['42501', '23503']).toContain(error?.code)
  })
})

describe('column grants: server-owned columns cannot be born or edited wrong (ADR-0019)', () => {
  it('categories.is_system cannot be inserted', async () => {
    const { error } = await a.client
      .from('categories')
      .insert({ user_id: a.id, name: 'Sneaky', is_system: true })
    expect(error?.code).toBe('42501')
  })

  it('categories.slug cannot be supplied', async () => {
    const { error } = await a.client
      .from('categories')
      .insert({ user_id: a.id, name: 'Sneaky', slug: 'food' })
    expect(error?.code).toBe('42501')
  })

  it('categories.is_system cannot be updated on your own row', async () => {
    const { error } = await a.client
      .from('categories')
      .update({ is_system: false })
      .eq('id', aIds.foodCategoryId)
    expect(error?.code).toBe('42501')
  })

  it.each([
    ['status', { status: 'confirmed' }],
    ['source', { source: 'sms' }],
    ['is_split', { is_split: true }],
  ])('transactions.%s cannot be inserted', async (_name, extra) => {
    const { error } = await a.client.from('transactions').insert({
      user_id: a.id,
      account_id: aIds.bankId,
      kind: 'expense',
      amount_minor: 100,
      category_id: aIds.foodCategoryId,
      occurred_on: aIds.today,
      ...extra,
    })
    expect(error?.code).toBe('42501')
  })

  it('gamification_profiles.xp_total cannot be written, even on your own row', async () => {
    const { error } = await a.client
      .from('gamification_profiles')
      .update({ xp_total: 999_999 })
      .eq('user_id', a.id)
    expect(error?.code).toBe('42501')
  })

  it('gamification events cannot be inserted by a client', async () => {
    const { error } = await a.client.from('gamification_events').insert({
      user_id: a.id,
      type: 'adjustment',
      xp_awarded: 1000,
      dedupe_key: randomUUID(),
      occurred_on: aIds.today,
    })
    expect(error?.code).toBe('42501')
  })

  it('budget_periods.closed_at and rollover_in_minor are server-owned', async () => {
    const closed = await a.client
      .from('budget_periods')
      .update({ closed_at: new Date().toISOString() })
      .eq('id', aIds.periodId)
    expect(closed.error?.code).toBe('42501')
    const rollover = await a.client
      .from('budget_periods')
      .update({ rollover_in_minor: 999_999 })
      .eq('id', aIds.periodId)
    expect(rollover.error?.code).toBe('42501')
  })

  it('audit_log has no client write grant', async () => {
    const { error } = await a.client
      .from('audit_log')
      .insert({ user_id: a.id, table_name: 'x', row_id: randomUUID(), action: 'insert' })
    expect(error?.code).toBe('42501')
  })
})

describe('goals over wallets (ADR-0026)', () => {
  it('a goal cannot point at the user’s own bank account (type-pinned FK)', async () => {
    const { error } = await a.client
      .from('goals')
      .insert({ user_id: a.id, wallet_account_id: aIds.bankId, name: 'x', target_minor: 100 })
    expect(error?.code).toBe('23503')
  })

  it('a goal cannot point at B’s wallet (composite FK)', async () => {
    const spare = await b.client
      .from('accounts')
      .insert({ user_id: b.id, name: 'Spare wallet', type: 'wallet' })
      .select('id')
      .single()
    const { error } = await a.client.from('goals').insert({
      user_id: a.id,
      wallet_account_id: (spare.data as { id: string }).id,
      name: 'x',
      target_minor: 100,
    })
    expect(error?.code).toBe('23503')
  })

  it('a goal cannot point at the wallet behind B’s goal either', async () => {
    // Refused by the one-goal-per-wallet unique index before the FK is even
    // reached. The id is a random UUID A could not have guessed.
    const { error } = await a.client
      .from('goals')
      .insert({ user_id: a.id, wallet_account_id: bIds.walletId, name: 'x', target_minor: 100 })
    expect(error).not.toBeNull()
  })

  it('wallet_account_type cannot be supplied', async () => {
    const { error } = await a.client.from('goals').insert({
      user_id: a.id,
      wallet_account_id: aIds.walletId,
      name: 'x',
      target_minor: 100,
      wallet_account_type: 'bank',
    })
    expect(error?.code).toBe('42501')
  })

  it('a wallet backs at most one goal', async () => {
    const { error } = await a.client.from('goals').insert({
      user_id: a.id,
      wallet_account_id: aIds.walletId,
      name: 'Second',
      target_minor: 100,
    })
    expect(error?.code).toBe('23505')
  })

  it('a goal cannot be re-pointed at another wallet', async () => {
    const { error } = await a.client
      .from('goals')
      .update({ wallet_account_id: aIds.bankId })
      .eq('id', aIds.goalId)
    expect(error?.code).toBe('42501')
  })

  it('a wallet that backs a goal cannot be retyped', async () => {
    const { error } = await a.client
      .from('accounts')
      .update({ type: 'bank' })
      .eq('id', aIds.walletId)
    expect(error?.code).toBe('23503')
  })

  it('there is no saved amount on a goal to forge', async () => {
    const { error } = await a.client
      .from('goals')
      .update({ saved_minor: 5_000_000 })
      .eq('id', aIds.goalId)
    expect(error).not.toBeNull()
  })
})

describe('RPCs derive the caller; none takes a user id', () => {
  it('A cannot replace the splits of B’s transaction — "not found", the same as a missing row', async () => {
    const { error } = await a.client.rpc('replace_transaction_splits', {
      p_transaction_id: bIds.transactionId,
      p_splits: [],
      p_category_id: aIds.foodCategoryId,
    })
    expect(error?.code).toBe('P0002')
    const missing = await a.client.rpc('replace_transaction_splits', {
      p_transaction_id: randomUUID(),
      p_splits: [],
      p_category_id: aIds.foodCategoryId,
    })
    expect(missing.error?.code).toBe('P0002')
  })

  it('A’s dashboard snapshot contains only A’s money', async () => {
    const { data, error } = await a.client.rpc('get_dashboard_snapshot', { p_today: aIds.today })
    expect(error).toBeNull()
    const ids = JSON.stringify(data)
    expect(ids).not.toContain(bIds.bankId)
    expect(ids).not.toContain(bIds.transactionId)
  })

  it('award_xp and evaluate_achievements are not callable by a client', async () => {
    const award = await a.client.rpc('award_xp', {
      p_user_id: a.id,
      p_type: 'adjustment',
      p_dedupe_key: randomUUID(),
      p_xp: 1000,
      p_occurred_on: aIds.today,
    })
    expect(award.error).not.toBeNull()
    const evaluate = await a.client.rpc('evaluate_achievements', { p_user_id: b.id })
    expect(evaluate.error).not.toBeNull()
  })
})

describe('anon holds nothing', () => {
  it.each(Object.keys(MATRIX))('%s: anon cannot select', async (table) => {
    const { data, error } = await anonClient().from(table).select('*').limit(1)
    expect(error?.code ?? (data?.length === 0 ? 'empty' : 'rows')).not.toBe('rows')
    expect(error?.code).toBe('42501')
  })

  it.each([
    'get_period_summary',
    'get_dashboard_snapshot',
    'ensure_budget_period',
    'daily_check_in',
    'delete_my_account',
  ])('%s: anon cannot call it', async (fn) => {
    const { error } = await anonClient().rpc(
      fn,
      fn === 'get_period_summary'
        ? { p_from: aIds.today, p_to: aIds.today }
        : fn === 'delete_my_account'
          ? {}
          : { p_today: aIds.today },
    )
    expect(error).not.toBeNull()
  })
})
