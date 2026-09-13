import type { Money } from '../money/Money'
import type { BudgetPeriod } from '../period/BudgetPeriod'

/**
 * One period's plan — a row of `budget_periods` (DATABASE.md §6.6).
 * A budget is a plan; transactions are facts (FINANCIAL-ENGINE.md §4.2).
 */
export interface BudgetPlan {
  readonly id: string
  readonly period: BudgetPeriod
  readonly expectedIncome: Money
  readonly plannedFixed: Money
  readonly plannedSavings: Money
  readonly overallLimit: Money | null
  readonly rolloverEnabled: boolean
  /** Written by the server when the period is created. Never by the client. */
  readonly rolloverIn: Money
  /** Closed periods are history: readable, never writable. */
  readonly closedAt: string | null
  readonly updatedAt: string
}

export interface CategoryLimit {
  readonly id: string
  readonly categoryId: string
  readonly limit: Money
  readonly rolloverEnabled: boolean
}

export function isClosed(plan: Pick<BudgetPlan, 'closedAt'>): boolean {
  return plan.closedAt !== null
}
