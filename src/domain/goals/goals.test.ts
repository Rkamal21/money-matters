import { describe, expect, it } from 'vitest'

import { fromMinor, type Money } from '../money/Money'
import { fromISO, toISO } from '../period/LocalDate'

import {
  calculateGoalPlan,
  calculateGoalProgress,
  goalStatus,
  projectGoalCompletion,
  type WalletEntry,
} from './goals'

const inr = (minor: bigint): Money => fromMinor(minor, 'INR')
const entry = (iso: string, minor: bigint): WalletEntry => ({
  occurredOn: fromISO(iso),
  amount: inr(minor),
})
const TODAY = fromISO('2026-09-14')

describe('goalStatus — derived, never stored', () => {
  it('archived beats achieved beats active', () => {
    expect(goalStatus({ archivedAt: '2026-09-01T00:00:00Z', reached: true })).toBe('archived')
    expect(goalStatus({ archivedAt: null, reached: true })).toBe('achieved')
    expect(goalStatus({ archivedAt: null, reached: false })).toBe('active')
  })
})

describe('calculateGoalProgress', () => {
  it('reports progress and what remains', () => {
    const progress = calculateGoalProgress({
      target: inr(5_000_000n),
      balance: inr(500_000n),
      reached: false,
    })
    expect(progress.progressRatio).toBeCloseTo(0.1)
    expect(progress.remaining.minor).toBe(4_500_000n)
    expect(progress.isAchieved).toBe(false)
  })

  it('caps the bar but reports the real value when over-saved', () => {
    const progress = calculateGoalProgress({ target: inr(100n), balance: inr(150n), reached: true })
    expect(progress.progressRatio).toBe(1.5)
    expect(progress.displayRatio).toBe(1)
    expect(progress.remaining.minor).toBe(0n)
  })

  it('reached then spent is still achieved — buying the laptop does not un-achieve it', () => {
    const progress = calculateGoalProgress({ target: inr(100n), balance: inr(5n), reached: true })
    expect(progress.isAchieved).toBe(true)
  })

  it('a negative wallet balance shows as zero on the bar', () => {
    const progress = calculateGoalProgress({
      target: inr(100n),
      balance: inr(-20n),
      reached: false,
    })
    expect(progress.progressRatio).toBeCloseTo(-0.2)
    expect(progress.displayRatio).toBe(0)
    expect(progress.remaining.minor).toBe(120n)
  })
})

describe('calculateGoalPlan', () => {
  const base = { target: inr(3_000_000n), balance: inr(0n), reached: false, today: TODAY }

  it('works out the required rate, rounding up', () => {
    const plan = calculateGoalPlan({ ...base, targetDate: fromISO('2026-10-13') })
    expect(plan.daysRemaining).toBe(30)
    expect(plan.requiredPerDay?.minor).toBe(100_000n)
    expect(plan.requiredPerWeek?.minor).toBe(700_000n)
    expect(plan.requiredPerMonth?.minor).toBe(3_000_000n)
    expect(plan.status).toBe('on_track')
  })

  it('never asks for more per week or month than is left', () => {
    const plan = calculateGoalPlan({ ...base, targetDate: fromISO('2026-09-15') })
    expect(plan.requiredPerWeek?.minor).toBe(3_000_000n)
    expect(plan.requiredPerMonth?.minor).toBe(3_000_000n)
  })

  it('is behind when the known rate will not get there', () => {
    const plan = calculateGoalPlan({
      ...base,
      targetDate: fromISO('2026-10-13'),
      ratePerDay: inr(50_000n),
    })
    expect(plan.status).toBe('behind')
  })

  it('a target date today leaves one day', () => {
    expect(calculateGoalPlan({ ...base, targetDate: TODAY }).daysRemaining).toBe(1)
  })

  it('a past target date, unmet, is overdue', () => {
    expect(calculateGoalPlan({ ...base, targetDate: fromISO('2026-09-01') }).status).toBe('overdue')
  })

  it('achieved stays achieved regardless of the date', () => {
    const plan = calculateGoalPlan({ ...base, reached: true, targetDate: fromISO('2026-09-01') })
    expect(plan.status).toBe('achieved')
    expect(plan.requiredPerDay).toBeNull()
    expect(calculateGoalPlan({ ...base, reached: true, targetDate: null }).daysRemaining).toBeNull()
  })

  it('without a target date there is nothing to be on track for', () => {
    expect(calculateGoalPlan({ ...base, targetDate: null }).status).toBe('no_target_date')
  })
})

describe('projectGoalCompletion', () => {
  const base = { target: inr(100_000n), balance: inr(20_000n), reached: false, today: TODAY }

  it('projects from the recent net rate, rounding the days up', () => {
    const projection = projectGoalCompletion({
      ...base,
      entries: [entry('2026-09-05', 10_000n), entry('2026-09-14', 10_000n)],
    })
    expect(projection.status).toBe('projected')
    if (projection.status !== 'projected') return
    // 20,000 over 10 days is 2,000/day; 80,000 to go is 40 days.
    expect(projection.ratePerDay.minor).toBe(2_000n)
    expect(toISO(projection.date)).toBe('2026-10-24')
    expect(projection.confidence).toBe('low')
  })

  it('an already-met target is achieved, with no projection', () => {
    expect(projectGoalCompletion({ ...base, reached: true, entries: [] })).toEqual({
      status: 'achieved',
    })
    expect(projectGoalCompletion({ ...base, balance: inr(100_000n), entries: [] })).toEqual({
      status: 'achieved',
    })
  })

  it('an empty wallet history is no_activity', () => {
    expect(projectGoalCompletion({ ...base, entries: [] })).toEqual({
      status: 'no_projection',
      reason: 'no_activity',
    })
  })

  it('one inflow is not a rate', () => {
    expect(projectGoalCompletion({ ...base, entries: [entry('2026-09-10', 5_000n)] })).toEqual({
      status: 'no_projection',
      reason: 'too_few_points',
    })
  })

  it('more out than in never arrives', () => {
    expect(
      projectGoalCompletion({
        ...base,
        entries: [entry('2026-09-01', 5_000n), entry('2026-09-10', -8_000n)],
      }),
    ).toEqual({ status: 'no_projection', reason: 'net_negative_rate' })
  })

  it('ignores activity outside the window', () => {
    expect(
      projectGoalCompletion({
        ...base,
        entries: [entry('2025-01-01', 50_000n), entry('2025-02-01', 50_000n)],
      }),
    ).toEqual({ status: 'no_projection', reason: 'no_activity' })
  })

  it('grows confident with steady, spread-out saving', () => {
    const entries = [0, 7, 14, 21, 28, 35, 42].map((offset) => {
      const day = String(1 + offset).padStart(2, '0')
      return offset < 30
        ? entry(`2026-08-${day}`, 1_000n)
        : entry(`2026-09-${String(offset - 30).padStart(2, '0')}`, 1_000n)
    })
    const projection = projectGoalCompletion({ ...base, entries })
    expect(projection.status === 'projected' && projection.confidence).toBe('high')
  })
})
