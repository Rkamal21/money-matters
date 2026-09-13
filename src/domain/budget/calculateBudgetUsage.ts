import {
  add,
  isPositive,
  max,
  multiplyByRatio,
  ratio,
  subtract,
  type Money,
  zero,
} from '../money/Money'
import { type BudgetPeriod, daysElapsed, daysInPeriod } from '../period/BudgetPeriod'
import type { LocalDate } from '../period/LocalDate'
import type { CategoryTotal } from '../transactions/PeriodSummary'
import type { Category } from '../transactions/types'

/**
 * Budget usage and status — FINANCIAL-ENGINE.md §4.
 *
 * Thresholds live in one product-owned object. Status is decided with integer
 * comparisons on minor units, so "exactly at the limit" means exactly.
 */

export type BudgetStatus = 'no_limit' | 'ok' | 'approaching' | 'at_limit' | 'exceeded'
export type BudgetPace = 'ahead' | 'on_track' | 'behind'

export const BUDGET_THRESHOLDS = {
  /** Percent of the limit at which a budget is "approaching". */
  approachingPercent: 75n,
  /** How far usage may drift from elapsed time before pace is not "on track". */
  paceTolerance: 0.05,
} as const

export interface BudgetUsage {
  readonly limit: Money | null
  readonly spentNet: Money
  /** `null` when there is no limit to be under. May be negative when over. */
  readonly remaining: Money | null
  /** 0..n; may exceed 1. Display only. */
  readonly usageRatio: number
  /** Share of the period gone, counting today. */
  readonly elapsedRatio: number
  readonly status: BudgetStatus
  /** "ahead" is spending faster than the calendar is moving. */
  readonly pace: BudgetPace
  /** Linear projection at the current rate. */
  readonly projectedEndOfPeriod: Money
}

export function budgetStatus(spentNet: Money, limit: Money | null): BudgetStatus {
  if (limit === null || !isPositive(limit)) return 'no_limit'
  if (spentNet.minor > limit.minor) return 'exceeded'
  if (spentNet.minor === limit.minor) return 'at_limit'
  if (spentNet.minor * 100n >= limit.minor * BUDGET_THRESHOLDS.approachingPercent) {
    return 'approaching'
  }
  return 'ok'
}

export function calculateBudgetUsage(input: {
  readonly limit: Money | null
  readonly spent: Money
  readonly refunded: Money
  readonly today: LocalDate
  readonly period: BudgetPeriod
}): BudgetUsage {
  const nothing = zero(input.spent.currency)
  const spentNet = max(nothing, subtract(input.spent, input.refunded))
  const status = budgetStatus(spentNet, input.limit)
  const hasLimit = status !== 'no_limit' && input.limit !== null

  const totalDays = daysInPeriod(input.period)
  const elapsed = daysElapsed(input.period, input.today)
  const elapsedRatio = totalDays === 0 ? 0 : elapsed / totalDays
  const usageRatio = hasLimit && input.limit !== null ? (ratio(spentNet, input.limit) ?? 0) : 0

  let pace: BudgetPace = 'on_track'
  if (hasLimit) {
    if (usageRatio > elapsedRatio + BUDGET_THRESHOLDS.paceTolerance) pace = 'ahead'
    else if (usageRatio < elapsedRatio - BUDGET_THRESHOLDS.paceTolerance) pace = 'behind'
  }

  return {
    limit: hasLimit ? input.limit : null,
    spentNet,
    remaining: hasLimit && input.limit !== null ? subtract(input.limit, spentNet) : null,
    usageRatio,
    elapsedRatio,
    status,
    pace,
    projectedEndOfPeriod:
      elapsed > 0 ? multiplyByRatio(spentNet, BigInt(totalDays), BigInt(elapsed)) : spentNet,
  }
}

/**
 * The whole-budget view: variable spending against `overallLimit`, or — when
 * no cap is set — against what the plan leaves for variable spending
 * (`expectedIncome + rolloverIn − plannedFixed − plannedSavings`, floored).
 */
export function calculateOverallBudgetUsage(input: {
  readonly plan: {
    readonly expectedIncome: Money
    readonly plannedFixed: Money
    readonly plannedSavings: Money
    readonly rolloverIn: Money
    readonly overallLimit?: Money | null
  }
  readonly variableSpent: Money
  readonly variableRefunded: Money
  readonly today: LocalDate
  readonly period: BudgetPeriod
}): BudgetUsage {
  const nothing = zero(input.plan.expectedIncome.currency)
  const derived = max(
    nothing,
    subtract(
      subtract(add(input.plan.expectedIncome, input.plan.rolloverIn), input.plan.plannedFixed),
      input.plan.plannedSavings,
    ),
  )
  return calculateBudgetUsage({
    limit: input.plan.overallLimit ?? derived,
    spent: input.variableSpent,
    refunded: input.variableRefunded,
    today: input.today,
    period: input.period,
  })
}

export interface CategoryUsage extends BudgetUsage {
  readonly category: Pick<Category, 'id' | 'name' | 'icon' | 'color' | 'treatment'>
}

/**
 * One usage row per expense category that has a limit or any spending,
 * limited categories first (most used first), then unlimited ones by spend.
 * Usage includes splits and nets refunds, because the totals come from
 * `transaction_category_amounts` (ROADMAP.md M4 acceptance).
 */
export function calculateCategoryUsages(input: {
  readonly categories: readonly Category[]
  readonly limits: ReadonlyMap<string, Money>
  readonly totals: readonly CategoryTotal[]
  readonly currency: string
  readonly today: LocalDate
  readonly period: BudgetPeriod
}): CategoryUsage[] {
  const nothing = zero(input.currency)
  const totalsById = new Map(input.totals.map((row) => [row.categoryId, row]))

  const rows = input.categories
    .filter((category) => category.kind === 'expense')
    .filter((category) => {
      const total = totalsById.get(category.id)
      const hasSpend =
        total !== undefined && (isPositive(total.expense) || isPositive(total.refund))
      return input.limits.has(category.id) || (hasSpend && !category.isArchived) || hasSpend
    })
    .map((category) => {
      const total = totalsById.get(category.id)
      const usage = calculateBudgetUsage({
        limit: input.limits.get(category.id) ?? null,
        spent: total?.expense ?? nothing,
        refunded: total?.refund ?? nothing,
        today: input.today,
        period: input.period,
      })
      return {
        ...usage,
        category: {
          id: category.id,
          name: category.name,
          icon: category.icon,
          color: category.color,
          treatment: category.treatment,
        },
      }
    })

  return rows.sort((a, b) => {
    const aLimited = a.status !== 'no_limit'
    const bLimited = b.status !== 'no_limit'
    if (aLimited !== bLimited) return aLimited ? -1 : 1
    if (aLimited) return b.usageRatio - a.usageRatio
    return Number(b.spentNet.minor - a.spentNet.minor)
  })
}
