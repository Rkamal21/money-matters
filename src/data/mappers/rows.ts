import { z } from 'zod'

import type { BudgetPlan, CategoryLimit } from '@/domain/budget/BudgetPlan'
import type { Achievement, GamificationProfile, XpEvent } from '@/domain/gamification/types'
import type { Goal, GoalWithProgress } from '@/domain/goals/Goal'
import { fromWire, type Money } from '@/domain/money/Money'
import { fromBounds } from '@/domain/period/BudgetPeriod'
import { fromISO, type LocalDate } from '@/domain/period/LocalDate'
import type { Profile } from '@/domain/profile/Profile'
import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import type { CategoryTotal, PeriodSummary } from '@/domain/transactions/PeriodSummary'
import type {
  Account,
  AccountWithBalance,
  Category,
  Transaction,
  TransactionSplit,
} from '@/domain/transactions/types'
import { AppErrorException, createAppError } from '@/lib/errors'

import type { Database } from '../supabase/database.types'

/**
 * Row ⇄ domain entity. This is where `bigint` becomes `Money`, which is what
 * makes "never float arithmetic on money" structurally true rather than a
 * guideline (API.md §3 rule 2). No feature ever sees `amount_minor`.
 */

type Tables = Database['public']['Tables']
type Functions = Database['public']['Functions']

export type ProfileRow = Tables['profiles']['Row']
export type AccountRow = Tables['accounts']['Row']
export type CategoryRow = Tables['categories']['Row']
export type TransactionRow = Tables['transactions']['Row']
export type SplitRow = Pick<
  Tables['transaction_splits']['Row'],
  'id' | 'category_id' | 'amount_minor' | 'note'
>
export type BudgetPeriodRow = Tables['budget_periods']['Row']
export type LimitRow = Tables['budget_category_limits']['Row']
export type GoalRow = Tables['goals']['Row']
export type MerchantRuleRow = Tables['merchant_rules']['Row']
export type PeriodSummaryRow = Functions['get_period_summary']['Returns'][number]

/** A malformed row is a data-access failure, never a silently wrong number. */
function corrupt(what: string, cause?: unknown): never {
  throw new AppErrorException(
    createAppError({
      kind: 'data_access',
      code: 'data.malformed',
      userMessage: 'Some of your data could not be read. Please try again.',
      cause: cause ?? what,
    }),
  )
}

export function money(value: unknown, currency: string): Money {
  try {
    return fromWire(value, currency)
  } catch (cause) {
    return corrupt('amount', cause)
  }
}

export function moneyOrNull(value: unknown, currency: string): Money | null {
  return value === null || value === undefined ? null : money(value, currency)
}

export function date(value: string): LocalDate {
  try {
    return fromISO(value)
  } catch (cause) {
    return corrupt('date', cause)
  }
}

export function dateOrNull(value: string | null): LocalDate | null {
  return value === null ? null : date(value)
}

export function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    timezone: row.timezone,
    currency: row.currency_code,
    locale: row.locale,
    budgetPeriodStartDay: row.budget_period_start_day,
    onboardingCompletedAt: row.onboarding_completed_at,
    onboardingVersion: row.onboarding_version,
    gamificationEnabled: row.gamification_enabled,
    updatedAt: row.updated_at,
  }
}

export function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency_code,
    openingBalance: money(row.opening_balance_minor, row.currency_code),
    creditLimit: moneyOrNull(row.credit_limit_minor, row.currency_code),
    institution: row.institution,
    last4: row.last4,
    isArchived: row.is_archived,
    position: row.position,
    updatedAt: row.updated_at,
  }
}

export function withBalance(account: Account, balanceMinor: unknown): AccountWithBalance {
  return {
    ...account,
    balance:
      balanceMinor === undefined || balanceMinor === null
        ? account.openingBalance
        : money(balanceMinor, account.currency),
  }
}

export function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    treatment: row.treatment,
    icon: row.icon,
    color: row.color,
    isSystem: row.is_system,
    isArchived: row.is_archived,
    position: row.position,
  }
}

export function mapSplit(row: SplitRow, currency: string): TransactionSplit {
  return {
    id: row.id,
    categoryId: row.category_id,
    amount: money(row.amount_minor, currency),
    note: row.note,
  }
}

export function mapTransaction(
  row: TransactionRow & { readonly transaction_splits?: readonly SplitRow[] | null },
): Transaction {
  return {
    id: row.id,
    kind: row.kind,
    amount: money(row.amount_minor, row.currency_code),
    accountId: row.account_id,
    counterAccountId: row.counter_account_id,
    categoryId: row.category_id,
    merchantLabel: row.merchant_label,
    description: row.description,
    notes: row.notes,
    occurredOn: date(row.occurred_on),
    isSplit: row.is_split,
    splits: (row.transaction_splits ?? []).map((split) => mapSplit(split, row.currency_code)),
    refundOfTransactionId: row.refund_of_transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

const DATERANGE = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/

export function mapBudgetPlan(
  row: Omit<BudgetPeriodRow, 'period'> & { readonly period: unknown },
  currency: string,
): BudgetPlan {
  const match = typeof row.period === 'string' ? DATERANGE.exec(row.period) : null
  if (match === null || match[1] === undefined || match[2] === undefined) return corrupt('period')
  return {
    id: row.id,
    period: fromBounds(match[1], match[2]),
    expectedIncome: money(row.expected_income_minor, currency),
    plannedFixed: money(row.planned_fixed_minor, currency),
    plannedSavings: money(row.planned_savings_minor, currency),
    overallLimit: moneyOrNull(row.overall_limit_minor, currency),
    rolloverEnabled: row.rollover_enabled,
    rolloverIn: money(row.rollover_in_minor, currency),
    closedAt: row.closed_at,
    updatedAt: row.updated_at,
  }
}

export function mapLimit(row: LimitRow, currency: string): CategoryLimit {
  return {
    id: row.id,
    categoryId: row.category_id,
    limit: money(row.limit_minor, currency),
    rolloverEnabled: row.rollover_enabled,
  }
}

export function mapGoal(row: GoalRow, currency: string): Goal {
  return {
    id: row.id,
    name: row.name,
    walletAccountId: row.wallet_account_id,
    target: money(row.target_minor, currency),
    targetDate: dateOrNull(row.target_date),
    priority: row.priority,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapGoalWithProgress(
  row: GoalRow,
  progress:
    | {
        readonly balance_minor: number | null
        readonly reached: boolean | null
        readonly reached_on: string | null
        readonly currency_code: string | null
      }
    | undefined,
): GoalWithProgress {
  const currency = progress?.currency_code ?? 'INR'
  return {
    ...mapGoal(row, currency),
    balance: money(progress?.balance_minor ?? 0, currency),
    reached: progress?.reached ?? false,
    reachedOn: dateOrNull(progress?.reached_on ?? null),
  }
}

export function mapMerchantRule(row: MerchantRuleRow): CategoryRule {
  return {
    id: row.id,
    userId: row.user_id,
    pattern: row.pattern,
    matchType: row.match_type,
    merchantLabel: row.merchant_label,
    categorySlug: row.category_slug,
    confidence: Number(row.confidence),
    priority: row.priority,
    isEnabled: row.is_enabled,
  }
}

export function mapGamificationProfile(row: {
  readonly xp_total: number
  readonly current_streak: number
  readonly longest_streak: number
  readonly last_check_in_on: string | null
}): GamificationProfile {
  return {
    xpTotal: row.xp_total,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    lastCheckInOn: dateOrNull(row.last_check_in_on),
  }
}

export function mapAchievement(
  row: Tables['achievements']['Row'],
  unlockedAt: string | null,
): Achievement {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    icon: row.icon,
    xpReward: row.xp_reward,
    unlockedAt,
  }
}

export function mapXpEvent(row: Tables['gamification_events']['Row']): XpEvent {
  return {
    id: row.id,
    type: row.type,
    xpAwarded: row.xp_awarded,
    occurredOn: date(row.occurred_on),
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Period summaries. `by_category` arrives as untyped JSON and is parsed like
// any other untrusted input (API.md §4).
// ---------------------------------------------------------------------------

const wireInt = z.number().int().refine(Number.isSafeInteger)

const categoryTotalSchema = z.object({
  category_id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  kind: z.enum(['expense', 'income']),
  treatment: z.enum(['fixed', 'variable', 'excluded']),
  icon: z.string(),
  color: z.string(),
  expense_minor: wireInt,
  refund_minor: wireInt,
  income_minor: wireInt,
  txn_count: z.number().int(),
})

export const byCategorySchema = z.array(categoryTotalSchema)

export function mapCategoryTotals(value: unknown, currency: string): CategoryTotal[] {
  const parsed = byCategorySchema.safeParse(value ?? [])
  if (!parsed.success) return corrupt('by_category', parsed.error)
  return parsed.data.map((row) => ({
    categoryId: row.category_id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    treatment: row.treatment,
    icon: row.icon,
    color: row.color,
    expense: money(row.expense_minor, currency),
    refund: money(row.refund_minor, currency),
    income: money(row.income_minor, currency),
    transactionCount: row.txn_count,
  }))
}

export function mapPeriodSummary(
  row: Omit<PeriodSummaryRow, 'by_category'> & { readonly by_category?: unknown },
  currency: string,
): PeriodSummary {
  return {
    income: money(row.income_minor, currency),
    expense: money(row.expense_minor, currency),
    refund: money(row.refund_minor, currency),
    fixed: money(row.fixed_minor, currency),
    fixedRefund: money(row.fixed_refund_minor, currency),
    variable: money(row.variable_minor, currency),
    variableRefund: money(row.variable_refund_minor, currency),
    excluded: money(row.excluded_minor, currency),
    excludedRefund: money(row.excluded_refund_minor, currency),
    transfers: money(row.transfer_in_minor, currency),
    transactionCount: row.transaction_count,
    byCategory: mapCategoryTotals(row.by_category, currency),
  }
}
