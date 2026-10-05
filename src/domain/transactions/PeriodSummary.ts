import { add, max, subtract, type Money, zero } from '../money/Money'

import type { CategoryKind, CategoryTreatment } from './types'

/**
 * The server-aggregated totals for a date range — `get_period_summary`
 * (API.md §4). Aggregation happens in Postgres; the domain receives totals,
 * never a row dump (ARCHITECTURE.md §G.1 rule 1).
 *
 * Every figure is gross; refunds are carried separately so each consumer
 * nets them the way FINANCIAL-ENGINE.md says to (ADR-0018).
 */
export interface CategoryTotal {
  readonly categoryId: string
  readonly slug: string
  readonly name: string
  readonly kind: CategoryKind
  readonly treatment: CategoryTreatment
  readonly icon: string
  readonly color: string
  readonly expense: Money
  readonly refund: Money
  readonly income: Money
  readonly transactionCount: number
}

export interface PeriodSummary {
  readonly income: Money
  readonly expense: Money
  readonly refund: Money
  readonly fixed: Money
  readonly fixedRefund: Money
  readonly variable: Money
  readonly variableRefund: Money
  readonly excluded: Money
  readonly excludedRefund: Money
  /** Moved between the user's own accounts. Never income, never spending. */
  readonly transfers: Money
  readonly transactionCount: number
  readonly byCategory: readonly CategoryTotal[]
}

export function emptySummary(currency: string): PeriodSummary {
  const nothing = zero(currency)
  return {
    income: nothing,
    expense: nothing,
    refund: nothing,
    fixed: nothing,
    fixedRefund: nothing,
    variable: nothing,
    variableRefund: nothing,
    excluded: nothing,
    excludedRefund: nothing,
    transfers: nothing,
    transactionCount: 0,
    byCategory: [],
  }
}

/** Income left after net spending; negative in a period that spent more than it earned. */
export function netIncome(summary: PeriodSummary): Money {
  return subtract(summary.income, netSpending(summary))
}

/** Variable spending net of its refunds, never below zero — the "spent today" of the safe daily limit. */
export function netVariable(summary: PeriodSummary): Money {
  return max(zero(summary.variable.currency), subtract(summary.variable, summary.variableRefund))
}

/**
 * What the user actually spent: fixed plus variable, net of refunds, floored
 * at zero per group. `excluded` categories are left out — they are, by
 * definition, spending that does not count (DATABASE.md §6.3).
 */
export function netSpending(summary: PeriodSummary): Money {
  const nothing = zero(summary.expense.currency)
  const fixed = max(nothing, subtract(summary.fixed, summary.fixedRefund))
  const variable = max(nothing, subtract(summary.variable, summary.variableRefund))
  return add(fixed, variable)
}
