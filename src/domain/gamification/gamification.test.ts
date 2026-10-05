import { describe, expect, it } from 'vitest'

import { fromISO } from '../period/LocalDate'

import {
  levelForXp,
  nextStreak,
  progressToNextLevel,
  XP_RULES,
  xpEventLabel,
  xpForLevel,
} from './gamification'

describe('levels', () => {
  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [101, 2],
    [250, 3],
    [-5, 1],
  ])('%s XP is level %s', (xp, level) => {
    expect(levelForXp(xp)).toBe(level)
  })

  it('xpForLevel inverts levelForXp at each boundary', () => {
    expect(xpForLevel(1)).toBe(0)
    expect(xpForLevel(3)).toBe(200)
    expect(levelForXp(xpForLevel(7))).toBe(7)
    expect(xpForLevel(0)).toBe(0)
  })

  it('reports progress within the level', () => {
    expect(progressToNextLevel(165)).toEqual({ level: 2, current: 65, needed: 100, ratio: 0.65 })
  })
})

describe('nextStreak — the transition table', () => {
  const today = fromISO('2026-09-14')

  it('starts at 1', () => {
    expect(nextStreak({ lastCheckInOn: null, today, current: 0 })).toEqual({
      streak: 1,
      changed: true,
      reason: 'first',
    })
  })

  it('is idempotent within a day', () => {
    expect(nextStreak({ lastCheckInOn: today, today, current: 4 })).toEqual({
      streak: 4,
      changed: false,
      reason: 'same_day',
    })
  })

  it('continues from yesterday', () => {
    expect(nextStreak({ lastCheckInOn: fromISO('2026-09-13'), today, current: 4 })).toEqual({
      streak: 5,
      changed: true,
      reason: 'continued',
    })
  })

  it('resets after a missed day', () => {
    expect(nextStreak({ lastCheckInOn: fromISO('2026-09-11'), today, current: 9 })).toEqual({
      streak: 1,
      changed: true,
      reason: 'reset',
    })
  })

  it('refuses a check-in dated after today (clock skew or a manipulated client)', () => {
    expect(nextStreak({ lastCheckInOn: fromISO('2026-09-15'), today, current: 3 })).toEqual({
      streak: 3,
      changed: false,
      reason: 'invalid',
    })
  })

  it('survives the UTC/IST boundary, because both sides are civil dates', () => {
    // 23:50 IST on the 13th and 00:10 IST on the 14th are different civil days
    // in Kolkata even though they are 20 minutes apart and the same UTC day.
    expect(nextStreak({ lastCheckInOn: fromISO('2026-09-13'), today, current: 1 }).reason).toBe(
      'continued',
    )
  })
})

describe('the XP catalog', () => {
  it('weights outcomes over activity', () => {
    const xp = (type: string) => XP_RULES.find((rule) => rule.type === type)?.xp
    expect(xp('period_under_budget')).toBe(50)
    expect(xp('transaction_logged')).toBe(5)
  })

  it('labels every event type', () => {
    expect(xpEventLabel('daily_check_in')).toBe('Daily check-in')
    expect(xpEventLabel('adjustment')).toBe('Adjustment')
  })
})
