import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SupabaseAccountRepository } from '@/data/repositories/AccountRepository'
import {
  type DashboardSnapshot,
  SupabaseAnalyticsRepository,
} from '@/data/repositories/AnalyticsRepository'
import { SupabaseBudgetRepository } from '@/data/repositories/BudgetRepository'
import { SupabaseCategoryRepository } from '@/data/repositories/CategoryRepository'
import { SupabaseMerchantRuleRepository } from '@/data/repositories/MerchantRuleRepository'
import { SupabaseTransactionRepository } from '@/data/repositories/TransactionRepository'
import type { Db } from '@/data/supabase/client'
import {
  actualsFromSummary,
  calculateSafeDailyLimit,
} from '@/domain/budget/calculateSafeDailyLimit'
import { fromMinor, type Money, zero } from '@/domain/money/Money'
import { addDays, fromISO, type LocalDate } from '@/domain/period/LocalDate'
import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import { parseTransactionMessage } from '@/domain/transactions/ingest/parseTransactionMessage'
import { confirmationRequestId, findSimilarTransactions } from '@/domain/transactions/ingest/review'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'
import { netVariable, type PeriodSummary } from '@/domain/transactions/PeriodSummary'
import type { Category } from '@/domain/transactions/types'
import {
  checkDraft,
  draftFromCandidate,
  type ReviewDraft,
  toSaveInput,
} from '@/features/transactions/detection/reviewDraft'
import { saveTransaction } from '@/features/transactions/services/saveTransaction'

import { adminClient, createUser, deleteUser, seedLedger, type TestUser } from './clients'

/**
 * Bank message → parser → review → "Confirm & Add" → the existing ledger, end
 * to end against the local database (ROADMAP.md M12). Each step is the
 * production code: the parser, the review mapping, `saveTransaction`, and the
 * repositories every screen reads — so a confirmed candidate is checked where
 * the Transactions list, account balances, the dashboard, the budget and the
 * safe daily limit get their numbers.
 *
 * Messages are anonymised: real formats, invented values.
 */

let user: TestUser
let ids: Awaited<ReturnType<typeof seedLedger>>
let today: LocalDate
let dated: string
let rules: CategoryRule[]
let categories: Category[]
let repos: {
  transactions: SupabaseTransactionRepository
  merchantRules: SupabaseMerchantRuleRepository
  accounts: SupabaseAccountRepository
  analytics: SupabaseAnalyticsRepository
  budgets: SupabaseBudgetRepository
  categories: SupabaseCategoryRepository
}

const inr = (minor: bigint): Money => fromMinor(minor, 'INR')

beforeAll(async () => {
  user = await createUser('detection')
  ids = await seedLedger(user)
  const db = user.client as unknown as Db
  repos = {
    transactions: new SupabaseTransactionRepository(db),
    merchantRules: new SupabaseMerchantRuleRepository(db),
    accounts: new SupabaseAccountRepository(db),
    analytics: new SupabaseAnalyticsRepository(db),
    budgets: new SupabaseBudgetRepository(db),
    categories: new SupabaseCategoryRepository(db),
  }
  today = fromISO(ids.today)
  const [y, m, d] = ids.today.split('-')
  dated = `${d}-${m}-${y?.slice(2)}`
  rules = await repos.merchantRules.list()
  categories = await repos.categories.list(user.id)

  // An expected income, so the safe daily limit has something to divide.
  const plan = await repos.budgets.ensurePeriod(today, 'INR')
  await repos.budgets.updatePlan(plan.id, { expectedIncome: inr(5_000_000n) }, 'INR')
}, 60_000)

afterAll(async () => {
  if (user) await deleteUser(user.id)
})

function candidateFor(text: string): TransactionCandidate {
  const result = parseTransactionMessage({ text, rules, categories })
  if (result.status !== 'candidate') throw new Error(`rejected: ${result.reason}`)
  return result.candidate
}

/** What "Confirm & Add" does: the review mapping, the form's validation, `saveTransaction`. */
async function confirm(text: string, edit: Partial<ReviewDraft> = {}) {
  const candidate = candidateFor(text)
  const accounts = await repos.accounts.list(user.id)
  const draft = {
    ...draftFromCandidate(candidate, { accounts, categories, today, currency: 'INR' }),
    ...edit,
  }
  const check = checkDraft(draft, { currency: 'INR', today })
  if (!check.ok) throw new Error(`invalid draft: ${JSON.stringify(check.errors)}`)
  const saved = await saveTransaction(
    toSaveInput(check.values, { userId: user.id, candidate, rules, categories, currency: 'INR' }),
    repos,
  )
  return { candidate, saved }
}

async function bankBalance(): Promise<bigint> {
  const bank = (await repos.accounts.list(user.id)).find((account) => account.id === ids.bankId)
  if (bank === undefined) throw new Error('bank account missing')
  return bank.balance.minor
}

async function periodSummary(): Promise<PeriodSummary> {
  const plan = await repos.budgets.ensurePeriod(today, 'INR')
  return repos.analytics.periodSummary(plan.period.start, plan.period.endExclusive, 'INR')
}

const categoryExpense = (summary: PeriodSummary, id: string) =>
  summary.byCategory.find((total) => total.categoryId === id)?.expense.minor ?? 0n

/** The dashboard widget's own call (SafeDailyLimitWidget), on the dashboard's own data. */
function safeDailyLimit(snapshot: DashboardSnapshot) {
  if (snapshot.plan === null || snapshot.summary === null) throw new Error('no budget period')
  const { plan } = snapshot
  return calculateSafeDailyLimit({
    period: plan.period,
    today,
    plan: {
      expectedIncome: plan.expectedIncome,
      plannedFixed: plan.plannedFixed,
      plannedSavings: plan.plannedSavings,
      rolloverIn: plan.rolloverIn,
      overallLimit: plan.overallLimit,
    },
    actuals: actualsFromSummary(snapshot.summary, netVariable(snapshot.todaySummary)),
    upcomingPlanned: zero('INR'),
    locale: 'en-IN',
  })
}

async function countByRequest(clientRequestId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('client_request_id', clientRequestId)
  if (error) throw error
  return count ?? 0
}

describe('a confirmed bank message is a ledger transaction like any other', () => {
  const message = () =>
    `Sent Rs.500.00 From HDFC Bank A/C *1234 To SWIGGY On ${dated} Ref 900000000101`

  it('appears in Transactions and moves the balance, dashboard, budget and safe daily limit', async () => {
    const balanceBefore = await bankBalance()
    const summaryBefore = await periodSummary()
    const snapshotBefore = await repos.analytics.dashboardSnapshot(today, 'INR')
    const limitBefore = safeDailyLimit(snapshotBefore)

    const { saved } = await confirm(message())

    // Transactions
    const listed = await repos.transactions.list(user.id, { from: today, to: today })
    expect(listed.items.find((row) => row.id === saved.id)).toMatchObject({
      kind: 'expense',
      amount: inr(50_000n),
      accountId: ids.bankId,
      categoryId: ids.foodCategoryId,
      merchantLabel: 'Swiggy',
      description: 'Swiggy',
      occurredOn: today,
      deletedAt: null,
    })

    // Account balance
    expect(await bankBalance()).toBe(balanceBefore - 50_000n)

    // Budget: the period's spending and the Food line
    const summaryAfter = await periodSummary()
    expect(summaryAfter.expense.minor - summaryBefore.expense.minor).toBe(50_000n)
    expect(
      categoryExpense(summaryAfter, ids.foodCategoryId) -
        categoryExpense(summaryBefore, ids.foodCategoryId),
    ).toBe(50_000n)

    // Dashboard
    const snapshotAfter = await repos.analytics.dashboardSnapshot(today, 'INR')
    expect(snapshotAfter.recent.some((row) => row.id === saved.id)).toBe(true)
    expect(
      (snapshotAfter.summary?.expense.minor ?? 0n) - (snapshotBefore.summary?.expense.minor ?? 0n),
    ).toBe(50_000n)
    const dashboardBank = (snapshot: DashboardSnapshot) =>
      snapshot.accounts.find((account) => account.id === ids.bankId)?.balance.minor ?? 0n
    expect(dashboardBank(snapshotBefore) - dashboardBank(snapshotAfter)).toBe(50_000n)

    // Safe daily limit: ₹500 less left in the period, ₹500 more spent today
    const limitAfter = safeDailyLimit(snapshotAfter)
    if (!('remaining' in limitBefore) || !('remaining' in limitAfter)) {
      throw new Error(`unexpected safe-daily-limit status: ${limitAfter.status}`)
    }
    expect(limitBefore.remaining.minor - limitAfter.remaining.minor).toBe(50_000n)
    expect((limitAfter.today?.spent.minor ?? 0n) - (limitBefore.today?.spent.minor ?? 0n)).toBe(
      50_000n,
    )
  })

  it('refuses the same message a second time: one row, balance unchanged', async () => {
    const candidate = candidateFor(message())
    const key = confirmationRequestId(candidate.fingerprint)

    // What the review screen sees before it enables "Confirm & Add".
    const existing = await repos.transactions.findByClientRequestId(user.id, key)
    expect(existing).not.toBeNull()

    const balanceBefore = await bankBalance()
    const again = await confirm(message(), { amount: '999' })
    expect(again.saved.id).toBe(existing?.id)
    expect(again.saved.amount).toEqual(inr(50_000n))
    expect(await countByRequest(key)).toBe(1)
    expect(await bankBalance()).toBe(balanceBefore)
  })
})

describe('income, edits, rejections and near-duplicates', () => {
  it('adds income under the salary category and raises the balance', async () => {
    const balanceBefore = await bankBalance()
    const summaryBefore = await periodSummary()

    const { saved } = await confirm(
      `Rs 25,000 credited to A/c XX1234 on ${dated} by NEFT from ACME PAYROLL`,
    )

    expect(saved).toMatchObject({ kind: 'income', categoryId: ids.salaryCategoryId })
    expect(await bankBalance()).toBe(balanceBefore + 2_500_000n)
    expect((await periodSummary()).income.minor - summaryBefore.income.minor).toBe(2_500_000n)
  })

  it('saves what the person edited, not what the message said', async () => {
    const otherIncome = categories.find((category) => category.slug === 'other_income')
    const { saved } = await confirm(
      `UPI transaction of Rs 299 to RAMESH on ${dated}. Ref 900000000102`,
      {
        kind: 'income',
        amount: '320',
        description: 'Ramesh paid back',
        categoryId: otherIncome?.id ?? '',
      },
    )
    expect(saved).toMatchObject({
      kind: 'income',
      amount: inr(32_000n),
      description: 'Ramesh paid back',
      categoryId: otherIncome?.id,
    })
  })

  it('writes nothing for a rejected message', async () => {
    const before = await repos.transactions.list(user.id, {})
    const result = parseTransactionMessage({
      text: '482913 is your OTP for a payment of Rs 2,500 to AMAZON',
      rules,
      categories,
    })
    expect(result).toEqual({ status: 'rejected', reason: 'otp' })
    expect((await repos.transactions.list(user.id, {})).items).toHaveLength(before.items.length)
  })

  it('flags a payment already typed by hand as a possible duplicate', async () => {
    // seedLedger typed "Swiggy dinner", ₹450, today, from the bank account.
    const candidate = candidateFor(
      `Sent Rs.450.00 From HDFC Bank A/C *1234 To SWIGGY On ${dated} Ref 900000000103`,
    )
    const nearby = await repos.transactions.list(user.id, {
      from: addDays(today, -1),
      to: addDays(today, 1),
    })
    const [match] = findSimilarTransactions(
      {
        amount: candidate.amount,
        kind: 'expense',
        occurredOn: today,
        accountId: ids.bankId,
        merchant: candidate.merchant,
      },
      nearby.items,
    )
    expect(match?.transaction.id).toBe(ids.transactionId)
    expect(match?.reasons).toEqual(
      expect.arrayContaining(['same_amount', 'same_day', 'same_account', 'same_merchant']),
    )
  })
})
