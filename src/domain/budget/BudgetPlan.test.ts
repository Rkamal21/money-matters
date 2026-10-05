import { describe, expect, it } from 'vitest'

import { fromMinor } from '../money/Money'
import { of } from '../period/LocalDate'

import { planPerDay } from './BudgetPlan'

const SEPTEMBER = { start: of(2026, 9, 1), endExclusive: of(2026, 10, 1) }
const inr = (minor: bigint) => fromMinor(minor, 'INR')

describe('planPerDay', () => {
  it('spreads what is available evenly over the days of the period', () => {
    expect(planPerDay(inr(30_000_00n), SEPTEMBER)).toEqual(inr(1_000_00n))
  })

  it('rounds down to the paisa, never promising more than there is', () => {
    expect(planPerDay(inr(100_00n), SEPTEMBER)).toEqual(inr(333n))
  })

  it('counts the period’s own days: 25 Feb → 24 Mar 2026 is 28 days', () => {
    const period = { start: of(2026, 2, 25), endExclusive: of(2026, 3, 25) }
    expect(planPerDay(inr(28_000_00n), period)).toEqual(inr(1_000_00n))
  })

  it('gives no daily figure when nothing is available', () => {
    expect(planPerDay(inr(0n), SEPTEMBER)).toBeNull()
    expect(planPerDay(inr(-500_00n), SEPTEMBER)).toBeNull()
  })
})
