import { divideFloor, isZero, max, subtract, sumAll, type Money, zero } from '../money/Money'

/**
 * Analytics — FINANCIAL-ENGINE.md §7. Pure functions over server aggregates.
 * No interpretation here; that is `insights/`.
 */

/**
 * `(income − expenses) / income`. With no income the rate is undefined — and
 * says so, rather than letting `NaN` or `Infinity` reach a component.
 */
export function calculateSavingsRate(input: {
  readonly income: Money
  readonly expenses: Money
}): { readonly status: 'ok'; readonly rate: number } | { readonly status: 'undefined' } {
  if (input.income.minor <= 0n) return { status: 'undefined' }
  const saved = subtract(input.income, input.expenses)
  return { status: 'ok', rate: Number(saved.minor) / Number(input.income.minor) }
}

export type PeriodComparison =
  | { readonly status: 'no_data' }
  /** Nothing last time, something now: "new", never "+∞%". */
  | { readonly status: 'new'; readonly delta: Money }
  | {
      readonly status: 'ok'
      readonly delta: Money
      /** Rounded half-up to one decimal place. Cosmetic only. */
      readonly percent: number
      readonly direction: 'up' | 'down' | 'flat'
    }

export function compareToPreviousPeriod(input: {
  readonly current: Money
  readonly previous: Money
}): PeriodComparison {
  const delta = subtract(input.current, input.previous)
  if (isZero(input.previous)) {
    return isZero(input.current) ? { status: 'no_data' } : { status: 'new', delta }
  }
  const raw = (Number(delta.minor) / Number(input.previous.minor)) * 100
  const percent = (Math.sign(raw) * Math.round(Math.abs(raw) * 10 + Number.EPSILON)) / 10
  return {
    status: 'ok',
    delta,
    percent,
    direction: delta.minor > 0n ? 'up' : delta.minor < 0n ? 'down' : 'flat',
  }
}

/**
 * Simple moving average over `window` points, rounded down. Labelled a trend,
 * not a prediction. The first `window − 1` points average what exists so far.
 */
export function spendingTrend(series: readonly Money[], window: number): Money[] {
  if (!Number.isInteger(window) || window < 1)
    throw new RangeError('window must be a positive integer')
  return series.map((_, index) => {
    const slice = series.slice(Math.max(0, index - window + 1), index + 1)
    const first = slice[0]
    if (first === undefined) throw new RangeError('unreachable: empty slice')
    return divideFloor(sumAll(slice, first.currency), BigInt(slice.length)).quotient
  })
}

/** Gross spending less its refunds, never below zero (ADR-0018). */
export function netOfRefunds(gross: Money, refunds: Money): Money {
  return max(zero(gross.currency), subtract(gross, refunds))
}

export interface IncomeVsExpenses {
  readonly income: Money
  readonly expenses: Money
  /** income − expenses; negative in a month that spent more than it earned. */
  readonly net: Money
}

export function incomeVsExpenses(input: {
  readonly income: Money
  readonly expense: Money
  readonly refund: Money
}): IncomeVsExpenses {
  const expenses = max(zero(input.expense.currency), subtract(input.expense, input.refund))
  return { income: input.income, expenses, net: subtract(input.income, expenses) }
}
