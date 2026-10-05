import { format } from '../money/format'
import {
  add,
  compare,
  divideFloor,
  isZero,
  max,
  min,
  negate,
  subtract,
  type Money,
  zero,
} from '../money/Money'
import {
  type BudgetPeriod,
  contains,
  daysInPeriod,
  daysRemaining as periodDaysRemaining,
  hasEnded,
} from '../period/BudgetPeriod'
import type { LocalDate } from '../period/LocalDate'
import type { PeriodSummary } from '../transactions/PeriodSummary'

/**
 * The safe daily limit — the product's hero number. FINANCIAL-ENGINE.md §3.
 *
 * The algorithm is §3.2, thirteen steps, and nowhere else in the codebase.
 * The result carries its own breakdown, so the widget can show *why* the
 * number is what it is without knowing how it was derived — which is what
 * lets a smarter strategy ship later without touching a component.
 */

export type IncomeBasis = 'planned' | 'actual' | 'greater'

export interface SafeDailyLimitInput {
  readonly period: BudgetPeriod
  readonly today: LocalDate
  readonly plan: {
    /** budget_periods.expected_income_minor — the plan. */
    readonly expectedIncome: Money
    /** Rent, EMIs, subscriptions. */
    readonly plannedFixed: Money
    /** Pay-yourself-first. */
    readonly plannedSavings: Money
    /** Carried surplus (+) or deficit (−) from the previous period. */
    readonly rolloverIn: Money
    /** Optional explicit cap on total variable spend. */
    readonly overallLimit?: Money | null
  }
  readonly actuals: {
    readonly incomeReceived: Money
    /** Spend in `fixed` categories, net of refunds. */
    readonly fixedPaid: Money
    /** Gross spend in `variable` categories. */
    readonly variableSpent: Money
    readonly refundsAgainstVariable: Money
    /** Today's variable spend, if known — enables the "left today" figure. */
    readonly variableSpentToday?: Money | null
  }
  /** Known future expenses inside the period. Zero at MVP (assumption S7). */
  readonly upcomingPlanned: Money
  /** Default `greater` — ADR-0021. */
  readonly policy?: { readonly incomeBasis?: IncomeBasis }
  readonly locale?: string
}

export type BreakdownSign = '+' | '−' | '='

export interface BreakdownLine {
  readonly key:
    | 'income'
    | 'rollover'
    | 'fixed'
    | 'savings'
    | 'upcoming'
    | 'cap'
    | 'spent'
    | 'refunds'
    | 'remaining'
  readonly label: string
  readonly amount: Money
  readonly sign: BreakdownSign
}

export interface TodayAllowance {
  /** What today was worth before today's spending. */
  readonly allowance: Money
  readonly spent: Money
  /** May be negative: today went over. */
  readonly left: Money
}

export type SafeDailyLimitResult =
  | {
      readonly status: 'ok' | 'tight' | 'comfortable'
      readonly limit: Money
      readonly daysRemaining: number
      readonly remaining: Money
      readonly buffer: Money
      /** What the limit would be on an even spread of the whole period. */
      readonly plannedDaily: Money
      readonly today: TodayAllowance | null
      readonly breakdown: readonly BreakdownLine[]
      readonly explanation: string
    }
  | {
      readonly status: 'overspent'
      readonly limit: Money
      readonly overspentBy: Money
      readonly daysRemaining: number
      readonly breakdown: readonly BreakdownLine[]
      readonly explanation: string
    }
  | {
      readonly status: 'insufficient_data'
      readonly missing: readonly ('expected_income' | 'budget_period')[]
    }
  | { readonly status: 'period_ended'; readonly period: BudgetPeriod }

export interface SafeDailyLimitStrategy {
  readonly id: string
  calculate(input: SafeDailyLimitInput): SafeDailyLimitResult
}

export interface Available {
  readonly income: Money
  readonly fixedAllowance: Money
  /** What may be spent on variable things this period, before any has been. */
  readonly available: Money
  /** True when `overallLimit` clamped `available`. */
  readonly capped: boolean
}

/** Steps 4–7: the discretionary allowance for the whole period. */
export function calculateAvailable(
  input: Pick<SafeDailyLimitInput, 'plan' | 'actuals' | 'upcomingPlanned' | 'policy'>,
): Available {
  const basis = input.policy?.incomeBasis ?? 'greater'
  const income =
    basis === 'planned'
      ? input.plan.expectedIncome
      : basis === 'actual'
        ? input.actuals.incomeReceived
        : max(input.plan.expectedIncome, input.actuals.incomeReceived)

  // S2: if real fixed spend already exceeded the plan, the excess is genuinely gone.
  const fixedAllowance = max(input.plan.plannedFixed, input.actuals.fixedPaid)

  const uncapped = subtract(
    subtract(
      subtract(add(income, input.plan.rolloverIn), fixedAllowance),
      input.plan.plannedSavings,
    ),
    input.upcomingPlanned,
  )

  const cap = input.plan.overallLimit ?? null
  if (cap !== null && compare(cap, uncapped) < 0) {
    return { income, fixedAllowance, available: cap, capped: true }
  }
  return { income, fixedAllowance, available: uncapped, capped: false }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function classify(limit: Money, plannedDaily: Money): 'ok' | 'tight' | 'comfortable' {
  if (plannedDaily.minor <= 0n) return 'tight'
  // Integer comparisons: limit ≥ 110% of plan is comfortable, < 75% is tight.
  if (limit.minor * 100n >= plannedDaily.minor * 110n) return 'comfortable'
  if (limit.minor * 100n >= plannedDaily.minor * 75n) return 'ok'
  return 'tight'
}

export function calculateSafeDailyLimit(input: SafeDailyLimitInput): SafeDailyLimitResult {
  const { period, today, plan, actuals } = input
  const currency = plan.expectedIncome.currency
  const nothing = zero(currency)
  const locale = input.locale ?? 'en-IN'

  // 1. A finished period shows its outcome, not a limit.
  if (hasEnded(period, today)) return { status: 'period_ended', period }

  // 2. Never lie by omission: no income is "set up your budget", not ₹0/day.
  if (isZero(plan.expectedIncome) && isZero(actuals.incomeReceived) && isZero(plan.rolloverIn)) {
    return { status: 'insufficient_data', missing: ['expected_income'] }
  }

  // 3. Today counts as remaining, so it is at least 1 inside the period.
  const daysRemaining = periodDaysRemaining(period, today)

  // 4–7.
  const { income, fixedAllowance, available, capped } = calculateAvailable(input)

  // 8. Refunds net against variable spend, floored at zero (ADR-0018).
  const netVariable = max(nothing, subtract(actuals.variableSpent, actuals.refundsAgainstVariable))

  // 9.
  const remaining = subtract(available, netVariable)

  const breakdown: BreakdownLine[] = [{ key: 'income', label: 'Income', amount: income, sign: '+' }]
  if (!isZero(plan.rolloverIn)) {
    breakdown.push({
      key: 'rollover',
      label: plan.rolloverIn.minor > 0n ? 'Carried over' : 'Carried deficit',
      amount: plan.rolloverIn.minor > 0n ? plan.rolloverIn : negate(plan.rolloverIn),
      sign: plan.rolloverIn.minor > 0n ? '+' : '−',
    })
  }
  breakdown.push({ key: 'fixed', label: 'Fixed costs', amount: fixedAllowance, sign: '−' })
  breakdown.push({ key: 'savings', label: 'Savings', amount: plan.plannedSavings, sign: '−' })
  if (!isZero(input.upcomingPlanned)) {
    breakdown.push({ key: 'upcoming', label: 'Upcoming', amount: input.upcomingPlanned, sign: '−' })
  }
  if (capped) {
    breakdown.push({
      key: 'cap',
      label: 'Capped at your spending limit',
      amount: available,
      sign: '=',
    })
  }
  breakdown.push({ key: 'spent', label: 'Spent so far', amount: actuals.variableSpent, sign: '−' })
  if (!isZero(actuals.refundsAgainstVariable)) {
    breakdown.push({
      key: 'refunds',
      label: 'Refunds',
      amount: actuals.refundsAgainstVariable,
      sign: '+',
    })
  }
  breakdown.push({ key: 'remaining', label: 'Left to spend', amount: remaining, sign: '=' })

  // 10. Over: say how far over, never show a negative limit.
  if (remaining.minor <= 0n) {
    const overspentBy = negate(remaining)
    return {
      status: 'overspent',
      limit: nothing,
      overspentBy,
      daysRemaining,
      breakdown,
      explanation: isZero(overspentBy)
        ? `Everything available this period is spent, with ${plural(daysRemaining, 'day')} to go.`
        : `${format(overspentBy, locale)} over, with ${plural(daysRemaining, 'day')} to go.`,
    }
  }

  // 11–12. Floor, never round: rounding up hands out money that is not there (S5).
  const { quotient: limit, remainder: buffer } = divideFloor(remaining, BigInt(daysRemaining))
  const plannedDaily = divideFloor(max(nothing, available), BigInt(daysInPeriod(period))).quotient

  let todayAllowance: TodayAllowance | null = null
  const spentToday = actuals.variableSpentToday ?? null
  if (spentToday !== null && contains(period, today)) {
    const allowance = divideFloor(add(remaining, spentToday), BigInt(daysRemaining)).quotient
    todayAllowance = { allowance, spent: spentToday, left: subtract(allowance, spentToday) }
  }

  // 13.
  return {
    status: classify(limit, plannedDaily),
    limit,
    daysRemaining,
    remaining,
    buffer,
    plannedDaily,
    today: todayAllowance,
    breakdown,
    explanation: `${format(remaining, locale)} left to spend over ${plural(daysRemaining, 'day')}, including today.`,
  }
}

/** The MVP strategy: spread what is left evenly over the days that are left (§3.6). */
export const EvenSpreadStrategy: SafeDailyLimitStrategy = {
  id: 'even-spread',
  calculate: calculateSafeDailyLimit,
}

/**
 * The actuals half of the input, from a server summary. Fixed spend is netted
 * against fixed refunds and floored; variable spend and its refunds stay
 * separate, because step 8 nets them.
 */
export function actualsFromSummary(
  summary: PeriodSummary,
  variableSpentToday?: Money | null,
): SafeDailyLimitInput['actuals'] {
  const nothing = zero(summary.income.currency)
  return {
    incomeReceived: summary.income,
    fixedPaid: max(nothing, subtract(summary.fixed, summary.fixedRefund)),
    variableSpent: summary.variable,
    refundsAgainstVariable: summary.variableRefund,
    variableSpentToday: variableSpentToday ?? null,
  }
}

/** Smallest of two money values, re-exported for callers building plans. */
export { min as minMoney }
