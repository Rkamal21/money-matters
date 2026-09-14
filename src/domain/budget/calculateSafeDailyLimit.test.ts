import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { CurrencyMismatchError, fromMinor, type Money } from '../money/Money'
import { fromBounds } from '../period/BudgetPeriod'
import { fromISO } from '../period/LocalDate'
import { emptySummary } from '../transactions/PeriodSummary'

import {
  actualsFromSummary,
  calculateAvailable,
  calculateSafeDailyLimit,
  EvenSpreadStrategy,
  type SafeDailyLimitInput,
} from './calculateSafeDailyLimit'

const rupees = (value: number): Money => fromMinor(BigInt(value) * 100n, 'INR')
const paise = (value: bigint): Money => fromMinor(value, 'INR')

const SEPTEMBER = fromBounds('2026-09-01', '2026-10-01')

/** The worked example of FINANCIAL-ENGINE.md §3.4, overridable field by field. */
function input(
  overrides: {
    today?: string
    period?: SafeDailyLimitInput['period']
    plan?: Partial<SafeDailyLimitInput['plan']>
    actuals?: Partial<SafeDailyLimitInput['actuals']>
    upcomingPlanned?: Money
    policy?: SafeDailyLimitInput['policy']
  } = {},
): SafeDailyLimitInput {
  return {
    period: overrides.period ?? SEPTEMBER,
    today: fromISO(overrides.today ?? '2026-09-11'),
    plan: {
      expectedIncome: rupees(60_000),
      plannedFixed: rupees(25_000),
      plannedSavings: rupees(10_000),
      rolloverIn: rupees(0),
      overallLimit: null,
      ...overrides.plan,
    },
    actuals: {
      incomeReceived: rupees(60_000),
      fixedPaid: rupees(25_000),
      variableSpent: rupees(8_000),
      refundsAgainstVariable: rupees(500),
      ...overrides.actuals,
    },
    upcomingPlanned: overrides.upcomingPlanned ?? rupees(0),
    ...(overrides.policy ? { policy: overrides.policy } : {}),
  }
}

describe('calculateSafeDailyLimit — the worked example (§3.4)', () => {
  it('is ₹875/day with ₹17,500 left over 20 days and no buffer', () => {
    const result = calculateSafeDailyLimit(input())
    expect(result.status).not.toBe('overspent')
    if (result.status !== 'ok' && result.status !== 'tight' && result.status !== 'comfortable')
      return
    expect(result.limit.minor).toBe(87_500n)
    expect(result.remaining.minor).toBe(1_750_000n)
    expect(result.daysRemaining).toBe(20)
    expect(result.buffer.minor).toBe(0n)
    expect(result.explanation).toBe('₹17,500 left to spend over 20 days, including today.')
  })

  it('carries a breakdown whose lines explain the number', () => {
    const result = calculateSafeDailyLimit(input())
    if (!('breakdown' in result)) throw new Error('expected a breakdown')
    expect(result.breakdown.map((line) => [line.key, line.sign, line.amount.minor])).toEqual([
      ['income', '+', 6_000_000n],
      ['fixed', '−', 2_500_000n],
      ['savings', '−', 1_000_000n],
      ['spent', '−', 800_000n],
      ['refunds', '+', 50_000n],
      ['remaining', '=', 1_750_000n],
    ])
  })

  it('does not divide by 30 — v1 said ₹833/day on the 1st and on the 30th', () => {
    const first = calculateSafeDailyLimit(
      input({
        today: '2026-09-01',
        actuals: { variableSpent: rupees(0), refundsAgainstVariable: rupees(0) },
      }),
    )
    const february = calculateSafeDailyLimit(
      input({
        period: fromBounds('2027-02-01', '2027-03-01'),
        today: '2027-02-01',
        actuals: { variableSpent: rupees(0), refundsAgainstVariable: rupees(0) },
      }),
    )
    const march = calculateSafeDailyLimit(
      input({
        period: fromBounds('2027-03-01', '2027-04-01'),
        today: '2027-03-01',
        actuals: { variableSpent: rupees(0), refundsAgainstVariable: rupees(0) },
      }),
    )
    if (!('limit' in first) || !('limit' in february) || !('limit' in march)) throw new Error()
    // ₹25,000 over 30, 28 and 31 days.
    expect(first.limit.minor).toBe(83_333n)
    expect(february.limit.minor).toBe(89_285n)
    expect(march.limit.minor).toBe(80_645n)
    expect(new Set([first.limit.minor, february.limit.minor, march.limit.minor]).size).toBe(3)
  })

  it('changes when a transaction is added, and again the next day', () => {
    const before = calculateSafeDailyLimit(input())
    const afterSpend = calculateSafeDailyLimit(input({ actuals: { variableSpent: rupees(9_000) } }))
    const nextDay = calculateSafeDailyLimit(
      input({ today: '2026-09-12', actuals: { variableSpent: rupees(9_000) } }),
    )
    if (!('limit' in before) || !('limit' in afterSpend) || !('limit' in nextDay)) throw new Error()
    expect(afterSpend.limit.minor).toBeLessThan(before.limit.minor)
    expect(nextDay.limit.minor).toBeGreaterThan(afterSpend.limit.minor)
  })
})

describe('the edge-case matrix (§3.5)', () => {
  it('zero income and zero rollover → insufficient_data, not ₹0', () => {
    expect(
      calculateSafeDailyLimit(
        input({ plan: { expectedIncome: rupees(0) }, actuals: { incomeReceived: rupees(0) } }),
      ),
    ).toEqual({ status: 'insufficient_data', missing: ['expected_income'] })
  })

  it('a positive rollover alone is enough data to advise on', () => {
    const result = calculateSafeDailyLimit(
      input({
        plan: {
          expectedIncome: rupees(0),
          plannedFixed: rupees(0),
          plannedSavings: rupees(0),
          rolloverIn: rupees(3_000),
        },
        actuals: {
          incomeReceived: rupees(0),
          fixedPaid: rupees(0),
          variableSpent: rupees(0),
          refundsAgainstVariable: rupees(0),
        },
      }),
    )
    expect(result.status).not.toBe('insufficient_data')
  })

  it('income consumed by fixed + savings → overspent by the variable spend', () => {
    const result = calculateSafeDailyLimit(
      input({ plan: { plannedFixed: rupees(40_000), plannedSavings: rupees(20_000) } }),
    )
    expect(result.status).toBe('overspent')
    if (result.status !== 'overspent') return
    expect(result.limit.minor).toBe(0n)
    expect(result.overspentBy.minor).toBe(750_000n)
    expect(result.explanation).toBe('₹7,500 over, with 20 days to go.')
  })

  it('exactly nothing left reads as spent, not as over', () => {
    const result = calculateSafeDailyLimit(input({ actuals: { variableSpent: rupees(25_500) } }))
    expect(result.status).toBe('overspent')
    if (result.status !== 'overspent') return
    expect(result.overspentBy.minor).toBe(0n)
    expect(result.explanation).toMatch(/Everything available/)
  })

  it('negative available keeps the cause visible in the breakdown', () => {
    const result = calculateSafeDailyLimit(
      input({
        plan: { plannedFixed: rupees(70_000) },
        actuals: {
          fixedPaid: rupees(0),
          variableSpent: rupees(0),
          refundsAgainstVariable: rupees(0),
        },
      }),
    )
    expect(result.status).toBe('overspent')
    if (result.status !== 'overspent') return
    expect(result.overspentBy.minor).toBe(2_000_000n)
    expect(result.breakdown.find((line) => line.key === 'remaining')?.amount.minor).toBe(
      -2_000_000n,
    )
  })

  it('the last day of the period: daysRemaining = 1 and the limit is everything left', () => {
    const result = calculateSafeDailyLimit(input({ today: '2026-09-30' }))
    if (!('limit' in result) || result.status === 'overspent') throw new Error()
    expect(result.daysRemaining).toBe(1)
    expect(result.limit.minor).toBe(result.remaining.minor)
  })

  it('the first day with nothing spent is available / days in the period', () => {
    const result = calculateSafeDailyLimit(
      input({
        today: '2026-09-01',
        actuals: { variableSpent: rupees(0), refundsAgainstVariable: rupees(0) },
      }),
    )
    if (!('limit' in result)) throw new Error()
    expect(result.limit.minor).toBe(2_500_000n / 30n)
  })

  it('a period not yet started spreads over all of it', () => {
    const result = calculateSafeDailyLimit(
      input({
        period: fromBounds('2026-10-01', '2026-11-01'),
        today: '2026-09-20',
        actuals: { variableSpent: rupees(0), refundsAgainstVariable: rupees(0) },
      }),
    )
    if (!('daysRemaining' in result)) throw new Error()
    expect(result.daysRemaining).toBe(31)
  })

  it('a finished period shows its outcome instead of a limit', () => {
    expect(calculateSafeDailyLimit(input({ today: '2026-10-01' }))).toEqual({
      status: 'period_ended',
      period: SEPTEMBER,
    })
  })

  it('an overall limit below the computed available clamps it, and says so', () => {
    const result = calculateSafeDailyLimit(input({ plan: { overallLimit: rupees(10_000) } }))
    if (!('breakdown' in result) || result.status === 'overspent') throw new Error()
    expect(result.remaining.minor).toBe(250_000n)
    expect(result.breakdown.some((line) => line.key === 'cap')).toBe(true)
  })

  it('an overall limit above available changes nothing', () => {
    const result = calculateSafeDailyLimit(input({ plan: { overallLimit: rupees(99_000) } }))
    if (!('limit' in result)) throw new Error()
    expect(result.limit.minor).toBe(87_500n)
  })

  it('real fixed spend above the plan is genuinely gone (S2)', () => {
    const result = calculateSafeDailyLimit(input({ actuals: { fixedPaid: rupees(27_000) } }))
    if (!('remaining' in result)) throw new Error()
    expect(result.remaining.minor).toBe(1_550_000n)
  })

  it('refunds larger than spending floor at zero rather than inflating the allowance', () => {
    const result = calculateSafeDailyLimit(
      input({ actuals: { variableSpent: rupees(100), refundsAgainstVariable: rupees(900) } }),
    )
    if (!('remaining' in result)) throw new Error()
    expect(result.remaining.minor).toBe(2_500_000n)
  })

  it('a negative rollover shows as a carried deficit', () => {
    const result = calculateSafeDailyLimit(input({ plan: { rolloverIn: rupees(-2_000) } }))
    if (!('breakdown' in result)) throw new Error()
    const line = result.breakdown.find((row) => row.key === 'rollover')
    expect(line?.sign).toBe('−')
    expect(line?.amount.minor).toBe(200_000n)
  })

  it('upcoming planned expenses are reserved when present', () => {
    const result = calculateSafeDailyLimit(input({ upcomingPlanned: rupees(5_000) }))
    if (!('remaining' in result)) throw new Error()
    expect(result.remaining.minor).toBe(1_250_000n)
  })

  it('mixed currencies throw', () => {
    expect(() =>
      calculateSafeDailyLimit(input({ actuals: { variableSpent: fromMinor(100n, 'USD') } })),
    ).toThrow(CurrencyMismatchError)
  })

  it('very large values stay exact', () => {
    const result = calculateSafeDailyLimit(
      input({
        plan: {
          expectedIncome: paise(899_999_999_999_999n),
          plannedFixed: rupees(0),
          plannedSavings: rupees(0),
        },
        actuals: {
          incomeReceived: paise(0n),
          fixedPaid: rupees(0),
          variableSpent: rupees(0),
          refundsAgainstVariable: rupees(0),
        },
      }),
    )
    if (!('limit' in result) || result.status === 'overspent') throw new Error()
    expect(result.limit.minor * 20n + result.buffer.minor).toBe(899_999_999_999_999n)
  })
})

describe('income basis (ADR-0021)', () => {
  const bonus = { actuals: { incomeReceived: rupees(70_000) } }
  const beforePayday = { actuals: { incomeReceived: rupees(0) } }

  it("'greater' spends a bonus that already landed", () => {
    expect(calculateAvailable(input(bonus)).income.minor).toBe(7_000_000n)
  })

  it("'greater' still budgets against the plan before payday", () => {
    expect(calculateAvailable(input(beforePayday)).income.minor).toBe(6_000_000n)
  })

  it("'planned' ignores the bonus until the user re-plans", () => {
    expect(
      calculateAvailable(input({ ...bonus, policy: { incomeBasis: 'planned' } })).income.minor,
    ).toBe(6_000_000n)
  })

  it("'actual' reads nothing before payday", () => {
    expect(
      calculateAvailable(input({ ...beforePayday, policy: { incomeBasis: 'actual' } })).income
        .minor,
    ).toBe(0n)
  })
})

describe('status classification', () => {
  it('is comfortable with plenty left, ok near plan, tight well under', () => {
    const early = calculateSafeDailyLimit(
      input({ actuals: { variableSpent: rupees(0), refundsAgainstVariable: rupees(0) } }),
    )
    const onPlan = calculateSafeDailyLimit(input())
    const heavy = calculateSafeDailyLimit(input({ actuals: { variableSpent: rupees(16_000) } }))
    expect(early.status).toBe('comfortable')
    expect(onPlan.status).toBe('ok')
    expect(heavy.status).toBe('tight')
  })
})

describe("today's allowance", () => {
  it('shows what today was worth before today, and what is left of it', () => {
    const result = calculateSafeDailyLimit(input({ actuals: { variableSpentToday: rupees(300) } }))
    if (!('today' in result) || result.today === null) throw new Error()
    // (₹17,500 + ₹300) / 20 = ₹890 for today, ₹590 of it left.
    expect(result.today.allowance.minor).toBe(89_000n)
    expect(result.today.left.minor).toBe(59_000n)
  })

  it('is absent when today is outside the period or the spend is unknown', () => {
    const unknown = calculateSafeDailyLimit(input())
    const future = calculateSafeDailyLimit(
      input({
        period: fromBounds('2026-10-01', '2026-11-01'),
        today: '2026-09-20',
        actuals: { variableSpentToday: rupees(10) },
      }),
    )
    expect('today' in unknown && unknown.today).toBeNull()
    expect('today' in future && future.today).toBeNull()
  })
})

describe('invariants', () => {
  it('property: limit × daysRemaining + buffer = remaining, for any inputs', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 50_000_000_000n }),
        fc.bigInt({ min: 0n, max: 20_000_000_000n }),
        fc.bigInt({ min: 0n, max: 20_000_000_000n }),
        fc.integer({ min: 1, max: 30 }),
        (income, fixed, spent, day) => {
          const result = calculateSafeDailyLimit(
            input({
              today: `2026-09-${String(day).padStart(2, '0')}`,
              plan: {
                expectedIncome: paise(income),
                plannedFixed: paise(fixed),
                plannedSavings: paise(0n),
              },
              actuals: {
                incomeReceived: paise(0n),
                fixedPaid: paise(0n),
                variableSpent: paise(spent),
                refundsAgainstVariable: paise(0n),
              },
            }),
          )
          if (result.status === 'overspent') return result.limit.minor === 0n
          if (!('limit' in result)) return false
          return (
            result.limit.minor * BigInt(result.daysRemaining) + result.buffer.minor ===
              result.remaining.minor &&
            result.buffer.minor >= 0n &&
            result.buffer.minor < BigInt(result.daysRemaining)
          )
        },
      ),
      { seed: 6, numRuns: 500 },
    )
  })

  it('the strategy object is the same calculation', () => {
    expect(EvenSpreadStrategy.calculate(input())).toEqual(calculateSafeDailyLimit(input()))
  })
})

describe('actualsFromSummary', () => {
  it('nets fixed refunds and keeps variable refunds separate', () => {
    const summary = {
      ...emptySummary('INR'),
      income: rupees(60_000),
      fixed: rupees(25_000),
      fixedRefund: rupees(1_000),
      variable: rupees(8_000),
      variableRefund: rupees(500),
    }
    const actuals = actualsFromSummary(summary, rupees(120))
    expect(actuals.fixedPaid.minor).toBe(2_400_000n)
    expect(actuals.variableSpent.minor).toBe(800_000n)
    expect(actuals.refundsAgainstVariable.minor).toBe(50_000n)
    expect(actuals.variableSpentToday?.minor).toBe(12_000n)
  })

  it('never lets fixed refunds make fixed spend negative', () => {
    const summary = { ...emptySummary('INR'), fixed: rupees(100), fixedRefund: rupees(900) }
    expect(actualsFromSummary(summary).fixedPaid.minor).toBe(0n)
  })
})
