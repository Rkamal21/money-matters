import { z } from 'zod'

import type { BudgetPlan } from '@/domain/budget/BudgetPlan'
import type { GamificationProfile } from '@/domain/gamification/types'
import type { GoalWithProgress } from '@/domain/goals/Goal'
import type { Money } from '@/domain/money/Money'
import { type BudgetPeriod, fromBounds } from '@/domain/period/BudgetPeriod'
import { toISO, type LocalDate } from '@/domain/period/LocalDate'
import type { PeriodSummary } from '@/domain/transactions/PeriodSummary'
import type { AccountType, TransactionKind } from '@/domain/transactions/types'
import { AppErrorException, createAppError } from '@/lib/errors'

import {
  date,
  dateOrNull,
  mapCategoryTotals,
  mapGamificationProfile,
  mapPeriodSummary,
  money,
  moneyOrNull,
} from '../mappers/rows'
import type { Db } from '../supabase/client'
import { fail } from '../supabase/mapErrors'

/**
 * Aggregates only — never rows. A method here that returned more than a few
 * hundred rows would be a design error, not a pagination problem (API.md §2.9).
 */

export type Granularity = 'day' | 'week' | 'month'

export interface SpendingPoint {
  readonly bucket: LocalDate
  readonly expense: Money
  readonly refund: Money
  readonly income: Money
}

export interface MonthComparison {
  readonly period: BudgetPeriod
  readonly income: Money
  readonly expense: Money
  readonly refund: Money
  readonly fixed: Money
  readonly variable: Money
  readonly variableRefund: Money
  readonly excluded: Money
  readonly plannedIncome: Money | null
}

export interface RecentTransaction {
  readonly id: string
  readonly kind: TransactionKind
  readonly amount: Money
  readonly occurredOn: LocalDate
  readonly description: string
  readonly merchantLabel: string | null
  readonly isSplit: boolean
  readonly categoryName: string | null
  readonly categoryIcon: string | null
  readonly categoryColor: string | null
  readonly accountName: string
  readonly counterAccountName: string | null
}

export interface SnapshotAccount {
  readonly id: string
  readonly name: string
  readonly type: AccountType
  readonly currency: string
  readonly balance: Money
  readonly creditLimit: Money | null
}

export interface DashboardSnapshot {
  readonly today: LocalDate
  readonly plan: BudgetPlan | null
  readonly summary: PeriodSummary | null
  readonly todaySummary: PeriodSummary
  readonly limits: ReadonlyMap<string, Money>
  readonly accounts: readonly SnapshotAccount[]
  readonly goals: readonly Omit<
    GoalWithProgress,
    'priority' | 'archivedAt' | 'createdAt' | 'updatedAt'
  >[]
  readonly recent: readonly RecentTransaction[]
  readonly gamification: GamificationProfile | null
}

export interface AnalyticsRepository {
  periodSummary(from: LocalDate, toExclusive: LocalDate, currency: string): Promise<PeriodSummary>
  spendingOverTime(
    from: LocalDate,
    toExclusive: LocalDate,
    granularity: Granularity,
    currency: string,
  ): Promise<SpendingPoint[]>
  monthlyComparison(today: LocalDate, months: number, currency: string): Promise<MonthComparison[]>
  dashboardSnapshot(today: LocalDate, currency: string): Promise<DashboardSnapshot>
}

// ---------------------------------------------------------------------------
// The snapshot is jsonb: untyped at the boundary, so it is parsed like any
// other untrusted input before a widget sees it (API.md §4).
// ---------------------------------------------------------------------------

const wireInt = z.number().int().refine(Number.isSafeInteger)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const summarySchema = z.object({
  income_minor: wireInt,
  expense_minor: wireInt,
  refund_minor: wireInt,
  fixed_minor: wireInt,
  fixed_refund_minor: wireInt,
  variable_minor: wireInt,
  variable_refund_minor: wireInt,
  excluded_minor: wireInt,
  excluded_refund_minor: wireInt,
  transfer_in_minor: wireInt,
  transfer_out_minor: wireInt,
  transaction_count: z.number().int(),
  by_category: z.unknown().optional(),
})

export const snapshotSchema = z.object({
  today: isoDate,
  period: z
    .object({
      id: z.string().uuid(),
      start: isoDate,
      end_exclusive: isoDate,
      expected_income_minor: wireInt,
      planned_fixed_minor: wireInt,
      planned_savings_minor: wireInt,
      overall_limit_minor: wireInt.nullable(),
      rollover_enabled: z.boolean(),
      rollover_in_minor: wireInt,
      closed_at: z.string().nullable(),
      updated_at: z.string(),
    })
    .nullable(),
  summary: summarySchema.nullable(),
  today_summary: summarySchema,
  category_limits: z.array(z.object({ category_id: z.string().uuid(), limit_minor: wireInt })),
  accounts: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      type: z.enum(['cash', 'bank', 'savings', 'wallet', 'credit_card']),
      currency_code: z.string().length(3),
      balance_minor: wireInt,
      credit_limit_minor: wireInt.nullable(),
      is_archived: z.boolean(),
    }),
  ),
  goals: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      target_minor: wireInt,
      target_date: isoDate.nullable(),
      wallet_account_id: z.string().uuid(),
      balance_minor: wireInt,
      reached: z.boolean(),
      reached_on: isoDate.nullable(),
      currency_code: z.string().length(3),
    }),
  ),
  recent_transactions: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.enum(['expense', 'income', 'transfer', 'refund']),
      amount_minor: wireInt,
      currency_code: z.string().length(3),
      occurred_on: isoDate,
      description: z.string(),
      merchant_label: z.string().nullable(),
      is_split: z.boolean(),
      category_name: z.string().nullable(),
      category_icon: z.string().nullable(),
      category_color: z.string().nullable(),
      account_name: z.string(),
      counter_account_name: z.string().nullable(),
    }),
  ),
  gamification: z
    .object({
      xp_total: z.number().int(),
      current_streak: z.number().int(),
      longest_streak: z.number().int(),
      last_check_in_on: isoDate.nullable(),
    })
    .nullable(),
})

type SummaryWire = z.infer<typeof summarySchema>

function summaryFromWire(wire: SummaryWire, currency: string): PeriodSummary {
  return {
    ...mapPeriodSummary({ ...wire, by_category: [] }, currency),
    byCategory: mapCategoryTotals(wire.by_category ?? [], currency),
  }
}

export function mapSnapshot(value: unknown, currency: string): DashboardSnapshot {
  const parsed = snapshotSchema.safeParse(value)
  if (!parsed.success) {
    throw new AppErrorException(
      createAppError({
        kind: 'data_access',
        code: 'dashboard.malformed',
        userMessage: 'Your dashboard could not be read. Please try again.',
        cause: parsed.error,
      }),
    )
  }
  const wire = parsed.data

  return {
    today: date(wire.today),
    plan:
      wire.period === null
        ? null
        : {
            id: wire.period.id,
            period: fromBounds(wire.period.start, wire.period.end_exclusive),
            expectedIncome: money(wire.period.expected_income_minor, currency),
            plannedFixed: money(wire.period.planned_fixed_minor, currency),
            plannedSavings: money(wire.period.planned_savings_minor, currency),
            overallLimit: moneyOrNull(wire.period.overall_limit_minor, currency),
            rolloverEnabled: wire.period.rollover_enabled,
            rolloverIn: money(wire.period.rollover_in_minor, currency),
            closedAt: wire.period.closed_at,
            updatedAt: wire.period.updated_at,
          },
    summary: wire.summary === null ? null : summaryFromWire(wire.summary, currency),
    todaySummary: summaryFromWire(wire.today_summary, currency),
    limits: new Map(
      wire.category_limits.map((row) => [row.category_id, money(row.limit_minor, currency)]),
    ),
    accounts: wire.accounts.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency_code,
      balance: money(row.balance_minor, row.currency_code),
      creditLimit: moneyOrNull(row.credit_limit_minor, row.currency_code),
    })),
    goals: wire.goals.map((row) => ({
      id: row.id,
      name: row.name,
      walletAccountId: row.wallet_account_id,
      target: money(row.target_minor, row.currency_code),
      targetDate: dateOrNull(row.target_date),
      balance: money(row.balance_minor, row.currency_code),
      reached: row.reached,
      reachedOn: dateOrNull(row.reached_on),
    })),
    recent: wire.recent_transactions.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: money(row.amount_minor, row.currency_code),
      occurredOn: date(row.occurred_on),
      description: row.description,
      merchantLabel: row.merchant_label,
      isSplit: row.is_split,
      categoryName: row.category_name,
      categoryIcon: row.category_icon,
      categoryColor: row.category_color,
      accountName: row.account_name,
      counterAccountName: row.counter_account_name,
    })),
    gamification: wire.gamification === null ? null : mapGamificationProfile(wire.gamification),
  }
}

export class SupabaseAnalyticsRepository implements AnalyticsRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async periodSummary(
    from: LocalDate,
    toExclusive: LocalDate,
    currency: string,
  ): Promise<PeriodSummary> {
    const { data, error } = await this.db.rpc('get_period_summary', {
      p_from: toISO(from),
      p_to: toISO(toExclusive),
    })
    if (error) fail(error, { operation: 'rpc', entity: 'summary' })
    const row = data[0]
    if (row === undefined) fail({ code: 'PGRST116' }, { entity: 'summary' })
    return mapPeriodSummary(row, currency)
  }

  async spendingOverTime(
    from: LocalDate,
    toExclusive: LocalDate,
    granularity: Granularity,
    currency: string,
  ): Promise<SpendingPoint[]> {
    const { data, error } = await this.db.rpc('get_spending_over_time', {
      p_from: toISO(from),
      p_to: toISO(toExclusive),
      p_granularity: granularity,
    })
    if (error) fail(error, { operation: 'rpc', entity: 'analytics' })
    return data.map((row) => ({
      bucket: date(row.bucket),
      expense: money(row.expense_minor, currency),
      refund: money(row.refund_minor, currency),
      income: money(row.income_minor, currency),
    }))
  }

  async monthlyComparison(
    today: LocalDate,
    months: number,
    currency: string,
  ): Promise<MonthComparison[]> {
    const { data, error } = await this.db.rpc('get_monthly_comparison', {
      p_today: toISO(today),
      p_months: months,
    })
    if (error) fail(error, { operation: 'rpc', entity: 'analytics' })
    return data.map((row) => ({
      period: fromBounds(row.period_start, row.period_end),
      income: money(row.income_minor, currency),
      expense: money(row.expense_minor, currency),
      refund: money(row.refund_minor, currency),
      fixed: money(row.fixed_minor, currency),
      variable: money(row.variable_minor, currency),
      variableRefund: money(row.variable_refund_minor, currency),
      excluded: money(row.excluded_minor, currency),
      plannedIncome: moneyOrNull(row.planned_income_minor, currency),
    }))
  }

  async dashboardSnapshot(today: LocalDate, currency: string): Promise<DashboardSnapshot> {
    const { data, error } = await this.db.rpc('get_dashboard_snapshot', { p_today: toISO(today) })
    if (error) fail(error, { operation: 'rpc', entity: 'dashboard' })
    return mapSnapshot(data, currency)
  }
}
