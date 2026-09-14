import { describe, expect, it } from 'vitest'

import { fromMinor, type Money } from '../money/Money'
import { fromBounds } from '../period/BudgetPeriod'
import { fromISO } from '../period/LocalDate'
import type { CategoryTotal } from '../transactions/PeriodSummary'
import type { Category } from '../transactions/types'

import {
  budgetStatus,
  calculateBudgetUsage,
  calculateCategoryUsages,
  calculateOverallBudgetUsage,
} from './calculateBudgetUsage'

const inr = (minor: bigint): Money => fromMinor(minor, 'INR')
const SEPTEMBER = fromBounds('2026-09-01', '2026-10-01')

describe('budgetStatus — thresholds at the boundaries', () => {
  it.each([
    [749n, 'ok'],
    [750n, 'approaching'],
    [999n, 'approaching'],
    [1000n, 'at_limit'],
    [1001n, 'exceeded'],
  ] as const)('spent %s of 1000 is %s', (spent, status) => {
    expect(budgetStatus(inr(spent), inr(1000n))).toBe(status)
  })

  it('a zero or missing limit is no_limit — never a division by zero', () => {
    expect(budgetStatus(inr(500n), inr(0n))).toBe('no_limit')
    expect(budgetStatus(inr(500n), null)).toBe('no_limit')
  })
})

describe('calculateBudgetUsage', () => {
  it('nets refunds and reports what is left', () => {
    const usage = calculateBudgetUsage({
      limit: inr(500_000n),
      spent: inr(400_000n),
      refunded: inr(50_000n),
      today: fromISO('2026-09-15'),
      period: SEPTEMBER,
    })
    expect(usage.spentNet.minor).toBe(350_000n)
    expect(usage.remaining?.minor).toBe(150_000n)
    expect(usage.usageRatio).toBeCloseTo(0.7)
    expect(usage.status).toBe('ok')
  })

  it('turns "60% spent" into "…and only 40% through the month"', () => {
    const usage = calculateBudgetUsage({
      limit: inr(1_000n),
      spent: inr(600n),
      refunded: inr(0n),
      today: fromISO('2026-09-12'),
      period: SEPTEMBER,
    })
    // Eleven whole days are behind us on the 12th.
    expect(usage.elapsedRatio).toBeCloseTo(11 / 30)
    expect(usage.pace).toBe('ahead')
  })

  it('is behind pace when spending trails the calendar, on track when close', () => {
    const base = {
      limit: inr(1_000n),
      refunded: inr(0n),
      today: fromISO('2026-09-15'),
      period: SEPTEMBER,
    }
    expect(calculateBudgetUsage({ ...base, spent: inr(100n) }).pace).toBe('behind')
    expect(calculateBudgetUsage({ ...base, spent: inr(500n) }).pace).toBe('on_track')
  })

  it('projects the end of the period linearly', () => {
    const usage = calculateBudgetUsage({
      limit: inr(1_000n),
      spent: inr(300n),
      refunded: inr(0n),
      today: fromISO('2026-09-10'),
      period: SEPTEMBER,
    })
    // ₹3 over the nine days before today, at that rate over thirty.
    expect(usage.projectedEndOfPeriod.minor).toBe(1000n)
  })

  it('never lets refunds make spending negative', () => {
    const usage = calculateBudgetUsage({
      limit: inr(1_000n),
      spent: inr(100n),
      refunded: inr(300n),
      today: fromISO('2026-09-10'),
      period: SEPTEMBER,
    })
    expect(usage.spentNet.minor).toBe(0n)
  })

  it('with no limit, there is nothing to be under and no pace to keep', () => {
    const usage = calculateBudgetUsage({
      limit: null,
      spent: inr(100n),
      refunded: inr(0n),
      today: fromISO('2026-09-01'),
      period: SEPTEMBER,
    })
    expect(usage.remaining).toBeNull()
    expect(usage.pace).toBe('on_track')
    expect(usage.usageRatio).toBe(0)
  })

  it('before the period starts, nothing has elapsed and nothing is projected', () => {
    const usage = calculateBudgetUsage({
      limit: inr(1_000n),
      spent: inr(0n),
      refunded: inr(0n),
      today: fromISO('2026-08-20'),
      period: SEPTEMBER,
    })
    expect(usage.elapsedRatio).toBe(0)
    expect(usage.projectedEndOfPeriod.minor).toBe(0n)
  })
})

describe('calculateOverallBudgetUsage', () => {
  const plan = {
    expectedIncome: inr(6_000_000n),
    plannedFixed: inr(2_500_000n),
    plannedSavings: inr(1_000_000n),
    rolloverIn: inr(0n),
  }

  it('uses what the plan leaves for variable spending when there is no cap', () => {
    const usage = calculateOverallBudgetUsage({
      plan,
      variableSpent: inr(800_000n),
      variableRefunded: inr(50_000n),
      today: fromISO('2026-09-11'),
      period: SEPTEMBER,
    })
    expect(usage.limit?.minor).toBe(2_500_000n)
    expect(usage.spentNet.minor).toBe(750_000n)
  })

  it('uses the explicit cap when there is one', () => {
    const usage = calculateOverallBudgetUsage({
      plan: { ...plan, overallLimit: inr(1_000_000n) },
      variableSpent: inr(0n),
      variableRefunded: inr(0n),
      today: fromISO('2026-09-11'),
      period: SEPTEMBER,
    })
    expect(usage.limit?.minor).toBe(1_000_000n)
  })

  it('a plan that leaves nothing is no_limit, not a zero to divide by', () => {
    const usage = calculateOverallBudgetUsage({
      plan: { ...plan, plannedFixed: inr(9_000_000n) },
      variableSpent: inr(1n),
      variableRefunded: inr(0n),
      today: fromISO('2026-09-11'),
      period: SEPTEMBER,
    })
    expect(usage.status).toBe('no_limit')
  })
})

describe('calculateCategoryUsages', () => {
  const category = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
    id,
    slug: id,
    name,
    kind: 'expense',
    treatment: 'variable',
    icon: 'circle',
    color: 'neutral',
    isSystem: true,
    isArchived: false,
    position: 0,
    ...extra,
  })
  const total = (categoryId: string, expense: bigint, refund = 0n): CategoryTotal => ({
    categoryId,
    slug: categoryId,
    name: categoryId,
    kind: 'expense',
    treatment: 'variable',
    icon: 'circle',
    color: 'neutral',
    expense: inr(expense),
    refund: inr(refund),
    income: inr(0n),
    transactionCount: 1,
  })

  it('lists limited categories first, most used first, then the unlimited by spend', () => {
    const rows = calculateCategoryUsages({
      categories: [
        category('food', 'Food'),
        category('shopping', 'Shopping'),
        category('travel', 'Travel'),
        category('health', 'Health'),
        category('salary', 'Salary', { kind: 'income' }),
      ],
      limits: new Map([
        ['food', inr(1_000n)],
        ['shopping', inr(1_000n)],
      ]),
      totals: [
        total('food', 300n),
        total('shopping', 900n, 100n),
        total('travel', 50n),
        total('health', 700n),
      ],
      currency: 'INR',
      today: fromISO('2026-09-15'),
      period: SEPTEMBER,
    })
    expect(rows.map((row) => row.category.id)).toEqual(['shopping', 'food', 'health', 'travel'])
    expect(rows[0]?.spentNet.minor).toBe(800n)
  })

  it('shows a limited category with no spending, and omits an idle unlimited one', () => {
    const rows = calculateCategoryUsages({
      categories: [category('food', 'Food'), category('idle', 'Idle')],
      limits: new Map([['food', inr(1_000n)]]),
      totals: [],
      currency: 'INR',
      today: fromISO('2026-09-15'),
      period: SEPTEMBER,
    })
    expect(rows.map((row) => row.category.id)).toEqual(['food'])
    expect(rows[0]?.status).toBe('ok')
  })
})
