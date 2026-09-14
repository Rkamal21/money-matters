import { createHmac, randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Real clients against the local Supabase, for the integration and RLS
 * suites. They talk to PostgREST and GoTrue exactly as the app does, so a
 * policy is tested the way an attacker with their own token would meet it
 * (SECURITY.md §1: "anyone can copy their access token and curl the endpoint").
 *
 * Local only. The keys are minted from the Supabase CLI's well-known local
 * JWT secret, which signs nothing outside a developer's Docker; the URL guard
 * refuses anything that is not 127.0.0.1/localhost.
 */

export const API_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321'

const LOCAL_JWT_SECRET =
  process.env['SUPABASE_JWT_SECRET'] ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

{
  const host = new URL(API_URL).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to run integration clients against ${host}: local Supabase only.`)
  }
}

function sign(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const head = encode({ alg: 'HS256', typ: 'JWT' })
  const body = encode(payload)
  const signature = createHmac('sha256', LOCAL_JWT_SECRET)
    .update(`${head}.${body}`)
    .digest('base64url')
  return `${head}.${body}.${signature}`
}

const expires = Math.floor(Date.now() / 1000) + 6 * 3600
export const ANON_KEY = sign({ iss: 'supabase-demo', role: 'anon', exp: expires })
const SERVICE_KEY = sign({ iss: 'supabase-demo', role: 'service_role', exp: expires })

const NO_SESSION = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- negative tests send columns the typed client forbids
export type AnyClient = SupabaseClient<any, 'public', 'public', any, any>

/** Bypasses RLS. Test set-up and verification only — never the subject of a test. */
export function adminClient(): AnyClient {
  return createClient(API_URL, SERVICE_KEY, NO_SESSION)
}

export function anonClient(): AnyClient {
  return createClient(API_URL, ANON_KEY, NO_SESSION)
}

export interface TestUser {
  readonly id: string
  readonly email: string
  readonly client: AnyClient
}

export const TEST_PASSWORD = 'correct-horse-battery-staple'

/** A confirmed user, signed in on their own client. The signup trigger has run. */
export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@test.local`
  const admin = adminClient()
  const created = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: label, timezone: 'Asia/Kolkata' },
  })
  if (created.error || !created.data.user) throw created.error ?? new Error('createUser failed')

  const client = createClient(API_URL, ANON_KEY, NO_SESSION)
  const signed = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (signed.error) throw signed.error

  return { id: created.data.user.id, email, client }
}

export async function deleteUser(id: string): Promise<void> {
  await adminClient().auth.admin.deleteUser(id)
}

export async function serverToday(client: AnyClient = adminClient()): Promise<string> {
  // PostgREST has no "select current_date"; the RPC that checks p_today uses
  // the server date, so read it from a harmless expression via a view-less call.
  const { data, error } = await client.rpc('user_today', {
    p_user_id: '00000000-0000-0000-0000-000000000000',
  })
  if (!error && typeof data === 'string') return data
  return new Date().toISOString().slice(0, 10)
}

/** Seed one of everything for a user; returns the ids the matrix points at. */
export async function seedLedger(user: TestUser) {
  const { client, id } = user
  const categories = await client.from('categories').select('id, slug, kind').eq('user_id', id)
  if (categories.error) throw categories.error
  const food = categories.data.find((row) => row.slug === 'food')
  const salary = categories.data.find((row) => row.slug === 'salary')
  if (!food || !salary) throw new Error('seed categories missing')

  const bank = await client
    .from('accounts')
    .insert({ user_id: id, name: 'Bank', type: 'bank', opening_balance_minor: 1_000_000 })
    .select('id')
    .single()
  if (bank.error) throw bank.error

  const wallet = await client
    .from('accounts')
    .insert({ user_id: id, name: 'Goal wallet', type: 'wallet' })
    .select('id')
    .single()
  if (wallet.error) throw wallet.error

  const today = new Date().toISOString().slice(0, 10)
  const transaction = await client
    .from('transactions')
    .insert({
      user_id: id,
      account_id: bank.data.id,
      kind: 'expense',
      amount_minor: 45_000,
      category_id: food.id,
      description: 'Swiggy dinner',
      occurred_on: today,
      client_request_id: randomUUID(),
    })
    .select('id')
    .single()
  if (transaction.error) throw transaction.error

  const goal = await client
    .from('goals')
    .insert({
      user_id: id,
      wallet_account_id: wallet.data.id,
      name: 'Laptop',
      target_minor: 5_000_000,
    })
    .select('id')
    .single()
  if (goal.error) throw goal.error

  const period = await client.rpc('ensure_budget_period', { p_today: today })
  if (period.error) throw period.error
  const periodId = (period.data as { id: string }).id

  const limit = await client
    .from('budget_category_limits')
    .insert({ user_id: id, budget_period_id: periodId, category_id: food.id, limit_minor: 600_000 })
    .select('id')
    .single()
  if (limit.error) throw limit.error

  const rule = await client
    .from('merchant_rules')
    .insert({
      user_id: id,
      pattern: 'mystore',
      match_type: 'contains',
      merchant_label: 'My Store',
      category_slug: 'food',
    })
    .select('id')
    .single()
  if (rule.error) throw rule.error

  return {
    foodCategoryId: food.id as string,
    salaryCategoryId: salary.id as string,
    bankId: bank.data.id as string,
    walletId: wallet.data.id as string,
    transactionId: transaction.data.id as string,
    goalId: goal.data.id as string,
    periodId,
    limitId: limit.data.id as string,
    ruleId: rule.data.id as string,
    today,
  }
}
