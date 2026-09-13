import { describe, expect, it } from 'vitest'

import { fromBounds } from '../period/BudgetPeriod'
import { fromISO } from '../period/LocalDate'
import { calculateBudgetUsage, type CategoryUsage } from '../budget/calculateBudgetUsage'
import {
  calculateFinancialHealthScore,
  scoreBudgetAdherence,
  scoreSavingsRate,
  scoreTrackingConsistency,
  scoreVolatility,
} from '../health/calculateFinancialHealthScore'
import { type FinancialSnapshot, RuleBasedInsightProvider } from '../insights/insights'
import { fromMinor, type Money } from '../money/Money'
import type { CategoryTotal } from '../transactions/PeriodSummary'

import {
  calculateSavingsRate,
  compareToPreviousPeriod,
  incomeVsExpenses,
  spendingTrend,
} from './analytics'

const inr = (minor: bigint): Money => fromMinor(minor, 'INR')

describe('calculateSavingsRate', () => {
  it('is (income − expenses) / income', () => {
    expect(calculateSavingsRate({ income: inr(1000n), expenses: inr(750n) })).toEqual({
      status: 'ok',
      rate: 0.25,
    })
  })

  it('may be negative in a month that spent more than it earned', () => {
    const result = calculateSavingsRate({ income: inr(1000n), expenses: inr(1500n) })
    expect(result.status === 'ok' && result.rate).toBe(-0.5)
  })

  it('income = 0 → undefined, never NaN or Infinity', () => {
    expect(calculateSavingsRate({ income: inr(0n), expenses: inr(10n) })).toEqual({
      status: 'undefined',
    })
  })
})

describe('compareToPreviousPeriod', () => {
  it('reports the delta and a rounded percentage', () => {
    expect(compareToPreviousPeriod({ current: inr(1240n), previous: inr(1000n) })).toEqual({
      status: 'ok',
      delta: inr(240n),
      percent: 24,
      direction: 'up',
    })
    const down = compareToPreviousPeriod({ current: inr(2n), previous: inr(3n) })
    expect(down.status === 'ok' && down.percent).toBe(-33.3)
  })

  it('a zero previous period is "new", not "+∞%"', () => {
    expect(compareToPreviousPeriod({ current: inr(500n), previous: inr(0n) })).toEqual({
      status: 'new',
      delta: inr(500n),
    })
    expect(compareToPreviousPeriod({ current: inr(0n), previous: inr(0n) })).toEqual({
      status: 'no_data',
    })
  })

  it('flat is flat', () => {
    const flat = compareToPreviousPeriod({ current: inr(5n), previous: inr(5n) })
    expect(flat.status === 'ok' && flat.direction).toBe('flat')
  })
})

describe('spendingTrend', () => {
  it('is a simple moving average, rounded down', () => {
    expect(spendingTrend([inr(10n), inr(20n), inr(31n), inr(40n)], 2).map((m) => m.minor)).toEqual([
      10n,
      15n,
      25n,
      35n,
    ])
  })

  it('refuses a nonsense window', () => {
    expect(() => spendingTrend([inr(1n)], 0)).toThrow(RangeError)
  })
})

describe('incomeVsExpenses', () => {
  it('nets refunds from expenses and reports the net', () => {
    expect(incomeVsExpenses({ income: inr(1000n), expense: inr(700n), refund: inr(100n) })).toEqual(
      {
        income: inr(1000n),
        expenses: inr(600n),
        net: inr(400n),
      },
    )
  })
})

describe('calculateFinancialHealthScore', () => {
  it('renormalises when a component has no data', () => {
    const result = calculateFinancialHealthScore({
      savingsRate: 1,
      budgetAdherence: 0,
      trackingConsistency: null,
      goalProgress: null,
      spendingVolatility: null,
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // 30 / (30 + 25) of full marks.
    expect(result.score).toBe(55)
    expect(result.band).toBe('fair')
    expect(result.components.map((c) => c.weight)).toEqual([54.5, 45.5])
    expect(result.weakest.key).toBe('budgetAdherence')
  })

  it('needs at least two components', () => {
    expect(
      calculateFinancialHealthScore({
        savingsRate: 0.5,
        budgetAdherence: null,
        trackingConsistency: null,
        goalProgress: null,
        spendingVolatility: null,
      }),
    ).toEqual({ status: 'insufficient_data' })
  })

  it('bands the score', () => {
    const all = (value: number) =>
      calculateFinancialHealthScore({
        savingsRate: value,
        budgetAdherence: value,
        trackingConsistency: value,
        goalProgress: value,
        spendingVolatility: value,
      })
    expect(all(0.1).status === 'ok' && all(0.1)).toMatchObject({ band: 'needs_attention' })
    expect(all(0.7)).toMatchObject({ band: 'good' })
    expect(all(1)).toMatchObject({ band: 'strong', score: 100 })
  })

  it('scores each component on its own scale', () => {
    expect(scoreSavingsRate(0.1)).toBe(0.5)
    expect(scoreSavingsRate(-1)).toBe(0)
    expect(scoreSavingsRate(null)).toBeNull()
    expect(scoreBudgetAdherence(3, 4)).toBe(0.75)
    expect(scoreBudgetAdherence(0, 0)).toBeNull()
    expect(scoreTrackingConsistency(30)).toBe(1)
    expect(scoreVolatility([100, 100, 100])).toBe(1)
    expect(scoreVolatility([1, 2])).toBeNull()
    expect(scoreVolatility([0, 0, 0])).toBeNull()
  })
})

describe('RuleBasedInsightProvider', () => {
  const PERIOD = fromBounds('2026-09-01', '2026-10-01')
  const total = (id: string, expense: bigint): CategoryTotal => ({
    categoryId: id,
    slug: id,
    name: id === 'food' ? 'Food' : id,
    kind: 'expense',
    treatment: 'variable',
    icon: 'circle',
    color: 'neutral',
    expense: inr(expense),
    refund: inr(0n),
    income: inr(0n),
    transactionCount: 1,
  })
  const usage = (
    id: string,
    spent: bigint,
    limit: bigint,
    today = '2026-09-10',
  ): CategoryUsage => ({
    ...calculateBudgetUsage({
      limit: inr(limit),
      spent: inr(spent),
      refunded: inr(0n),
      today: fromISO(today),
      period: PERIOD,
    }),
    category: {
      id,
      name: id === 'food' ? 'Food' : id,
      icon: 'circle',
      color: 'neutral',
      treatment: 'variable',
    },
  })

  const snapshot = (overrides: Partial<FinancialSnapshot> = {}): FinancialSnapshot => ({
    currency: 'INR',
    locale: 'en-IN',
    elapsedRatio: 0.3,
    current: { income: inr(6_000_000n), spending: inr(1_000_000n), byCategory: [] },
    previous: null,
    categoryUsage: [],
    overall: null,
    hasExpectedIncome: true,
    goalsBehind: [],
    ...overrides,
  })

  it('says comparisons need history rather than inventing one', async () => {
    const insights = await RuleBasedInsightProvider.generate(snapshot())
    expect(insights.map((i) => i.id)).toContain('needs-history')
  })

  it('asks for an expected income when none is set', async () => {
    const insights = await RuleBasedInsightProvider.generate(snapshot({ hasExpectedIncome: false }))
    expect(insights[0]?.id).toBe('set-budget')
  })

  it('flags a category up sharply on last period, with real numbers', async () => {
    const insights = await RuleBasedInsightProvider.generate(
      snapshot({
        current: { income: inr(0n), spending: inr(0n), byCategory: [total('food', 620_000n)] },
        previous: { income: inr(0n), spending: inr(0n), byCategory: [total('food', 500_000n)] },
      }),
    )
    const up = insights.find((i) => i.id === 'category-up:food')
    expect(up?.title).toBe('Food is up 24%')
    expect(up?.body).toContain('₹6,200')
  })

  it('stays quiet about small moves', async () => {
    const insights = await RuleBasedInsightProvider.generate(
      snapshot({
        current: { income: inr(0n), spending: inr(0n), byCategory: [total('food', 12_000n)] },
        previous: { income: inr(0n), spending: inr(0n), byCategory: [total('food', 5_000n)] },
      }),
    )
    expect(insights.some((i) => i.id.startsWith('category-'))).toBe(false)
  })

  it('warns about pace and about an exceeded limit', async () => {
    const insights = await RuleBasedInsightProvider.generate(
      snapshot({ categoryUsage: [usage('food', 800n, 1000n), usage('fun', 1500n, 1000n)] }),
    )
    expect(insights.map((i) => i.id)).toEqual(expect.arrayContaining(['pace:food', 'over:fun']))
  })

  it('celebrates a healthy savings rate, and nothing when income is zero', async () => {
    const good = await RuleBasedInsightProvider.generate(snapshot())
    expect(good.find((i) => i.id === 'savings-rate')?.title).toBe(
      "You've kept 83% of this period's income",
    )
    const none = await RuleBasedInsightProvider.generate(
      snapshot({ current: { income: inr(0n), spending: inr(100n), byCategory: [] } }),
    )
    expect(none.some((i) => i.id === 'savings-rate')).toBe(false)
  })

  it('flags a goal that is behind', async () => {
    const insights = await RuleBasedInsightProvider.generate(
      snapshot({ goalsBehind: [{ id: 'g1', name: 'Laptop' }] }),
    )
    expect(insights.find((i) => i.id === 'goal-behind:g1')?.action?.route).toBe('/goals/g1')
  })
})
