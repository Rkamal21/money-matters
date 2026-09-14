import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  contains,
  daysElapsed,
  daysInPeriod,
  daysRemaining,
  formatPeriodLabel,
  fromBounds,
  hasEnded,
  lastDay,
  nextPeriod,
  periodKey,
  previousPeriod,
  resolveCurrentPeriod,
} from './BudgetPeriod'
import { fixedClock, today } from './Clock'
import {
  addDays,
  addMonths,
  compare,
  dayOfWeek,
  daysBetween,
  endOfMonth,
  formatDate,
  fromEpochDay,
  fromInstant,
  fromISO,
  isLeapYear,
  lengthOfMonth,
  of,
  startOfMonth,
  toEpochDay,
  toISO,
  toUtcEpochMs,
  tryFromISO,
} from './LocalDate'

const HOUR = 3_600_000
const MINUTE = 60_000

/** An instant given as a UTC civil date plus an offset in hours and minutes. No `Date` needed. */
function utc(iso: string, hours = 0, minutes = 0): number {
  return toUtcEpochMs(fromISO(iso)) + hours * HOUR + minutes * MINUTE
}

describe('LocalDate', () => {
  it('round-trips ISO text and refuses what is not a calendar date', () => {
    expect(toISO(fromISO('2026-09-07'))).toBe('2026-09-07')
    expect(tryFromISO('2026-02-30')).toBeNull()
    expect(tryFromISO('2026-9-7')).toBeNull()
    expect(() => fromISO('nonsense')).toThrow(RangeError)
    expect(() => of(2026, 13, 1)).toThrow(RangeError)
  })

  it('knows its leap years: February 2028 has 29 days', () => {
    expect(lengthOfMonth(2028, 2)).toBe(29)
    expect(lengthOfMonth(2026, 2)).toBe(28)
    expect(isLeapYear(2000)).toBe(true)
    expect(isLeapYear(1900)).toBe(false)
    expect(lengthOfMonth(2026, 4)).toBe(30)
    expect(lengthOfMonth(2026, 12)).toBe(31)
  })

  it('adds months by clamping the day', () => {
    expect(toISO(addMonths(fromISO('2026-01-31'), 1))).toBe('2026-02-28')
    expect(toISO(addMonths(fromISO('2028-01-31'), 1))).toBe('2028-02-29')
    expect(toISO(addMonths(fromISO('2026-11-15'), 3))).toBe('2027-02-15')
    expect(toISO(addMonths(fromISO('2026-01-15'), -1))).toBe('2025-12-15')
  })

  it('knows the start and end of a month and the day of the week', () => {
    expect(toISO(startOfMonth(fromISO('2026-09-14')))).toBe('2026-09-01')
    expect(toISO(endOfMonth(fromISO('2028-02-10')))).toBe('2028-02-29')
    expect(dayOfWeek(fromISO('2026-09-14'))).toBe(0) // Monday
    expect(dayOfWeek(fromISO('1970-01-01'))).toBe(3) // Thursday
  })

  it('formats a civil date without any zone moving it', () => {
    expect(formatDate(fromISO('2026-09-07'), 'en-IN')).toBe('7 Sept 2026')
    expect(formatDate(fromISO('2026-09-07'), 'en-US', { month: 'long', day: 'numeric' })).toBe(
      'September 7',
    )
  })

  describe('fromInstant — the single timezone conversion in the system', () => {
    it("today is the user's local date, not the UTC date (the v1 regression)", () => {
      // 00:30 IST on 8 Sep is 19:00 UTC on 7 Sep.
      expect(toISO(fromInstant(utc('2026-09-07', 19), 'Asia/Kolkata'))).toBe('2026-09-08')
      expect(toISO(fromInstant(utc('2026-09-07', 19), 'UTC'))).toBe('2026-09-07')
    })

    it('an IST user at 23:59 on 30 Sep is still in September', () => {
      expect(toISO(fromInstant(utc('2026-09-30', 18, 29), 'Asia/Kolkata'))).toBe('2026-09-30')
      expect(toISO(fromInstant(utc('2026-09-30', 18, 30), 'Asia/Kolkata'))).toBe('2026-10-01')
    })

    it('follows daylight saving in Los Angeles', () => {
      // After spring-forward (8 Mar 2026) LA is UTC−7: 07:30Z on 9 Mar is 00:30 local on 9 Mar.
      expect(toISO(fromInstant(utc('2026-03-09', 7, 30), 'America/Los_Angeles'))).toBe('2026-03-09')
      // Before it, UTC−8: the same wall time is 08:30Z.
      expect(toISO(fromInstant(utc('2026-03-02', 7, 30), 'America/Los_Angeles'))).toBe('2026-03-01')
    })

    it('handles a fractional offset (Pacific/Chatham, UTC+12:45)', () => {
      expect(toISO(fromInstant(utc('2026-07-01', 11, 20), 'Pacific/Chatham'))).toBe('2026-07-02')
      expect(toISO(fromInstant(utc('2026-07-01', 11, 10), 'Pacific/Chatham'))).toBe('2026-07-01')
    })

    it('reads today through an injected clock', () => {
      expect(toISO(today(fixedClock(utc('2026-09-07', 19)), 'Asia/Kolkata'))).toBe('2026-09-08')
    })
  })

  it('daysBetween is 1 across a spring-forward day and a fall-back day', () => {
    expect(daysBetween(fromISO('2026-03-08'), fromISO('2026-03-09'))).toBe(1)
    expect(daysBetween(fromISO('2026-11-01'), fromISO('2026-11-02'))).toBe(1)
  })

  it('property: daysBetween(a, addDays(a, n)) === n, across leap years and DST', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -200_000, max: 200_000 }),
        fc.integer({ min: -5000, max: 5000 }),
        (epochDay, n) => {
          const a = fromEpochDay(epochDay)
          return daysBetween(a, addDays(a, n)) === n
        },
      ),
      { seed: 4, numRuns: 1000 },
    )
  })

  it('property: epoch days and ISO text round-trip', () => {
    fc.assert(
      fc.property(fc.integer({ min: -700_000, max: 2_900_000 }), (epochDay) => {
        const date = fromEpochDay(epochDay)
        return toEpochDay(date) === epochDay && compare(fromISO(toISO(date)), date) === 0
      }),
      { seed: 5, numRuns: 1000 },
    )
  })
})

describe('BudgetPeriod', () => {
  it('resolves a calendar month for startDay 1', () => {
    const period = resolveCurrentPeriod({ today: fromISO('2026-09-11'), startDay: 1 })
    expect(toISO(period.start)).toBe('2026-09-01')
    expect(toISO(period.endExclusive)).toBe('2026-10-01')
    expect(daysInPeriod(period)).toBe(30)
    expect(daysRemaining(period, fromISO('2026-09-11'))).toBe(20)
  })

  it('gives a user paid on the 25th a 25th → 24th period', () => {
    const period = resolveCurrentPeriod({ today: fromISO('2026-09-14'), startDay: 25 })
    expect(toISO(period.start)).toBe('2026-08-25')
    expect(toISO(lastDay(period))).toBe('2026-09-24')
    expect(toISO(resolveCurrentPeriod({ today: fromISO('2026-09-25'), startDay: 25 }).start)).toBe(
      '2026-09-25',
    )
  })

  it('startDay 28 produces a valid period in every month of a leap year', () => {
    for (let m = 1; m <= 12; m += 1) {
      const period = resolveCurrentPeriod({ today: of(2028, m, 28), startDay: 28 })
      expect(period.start.d).toBe(28)
      expect(period.endExclusive.d).toBe(28)
    }
    const february = resolveCurrentPeriod({ today: fromISO('2028-02-28'), startDay: 28 })
    expect(toISO(february.endExclusive)).toBe('2028-03-28')
    expect(daysInPeriod(february)).toBe(29)
  })

  it('refuses a start day outside 1–28', () => {
    expect(() => resolveCurrentPeriod({ today: fromISO('2026-09-01'), startDay: 31 })).toThrow(
      RangeError,
    )
    expect(() => resolveCurrentPeriod({ today: fromISO('2026-09-01'), startDay: 0 })).toThrow(
      RangeError,
    )
  })

  it('counts today as remaining: the last day has 1 day left, never 0', () => {
    const period = resolveCurrentPeriod({ today: fromISO('2026-09-30'), startDay: 1 })
    expect(daysRemaining(period, fromISO('2026-09-30'))).toBe(1)
    expect(daysElapsed(period, fromISO('2026-09-30'))).toBe(29)
  })

  it('before the period starts, the whole period remains; after it ends, none does', () => {
    const period = fromBounds('2026-10-01', '2026-11-01')
    expect(daysRemaining(period, fromISO('2026-09-20'))).toBe(31)
    expect(daysElapsed(period, fromISO('2026-09-20'))).toBe(0)
    expect(daysRemaining(period, fromISO('2026-11-01'))).toBe(0)
    expect(hasEnded(period, fromISO('2026-11-01'))).toBe(true)
    expect(hasEnded(period, fromISO('2026-10-31'))).toBe(false)
  })

  it('is half-open', () => {
    const period = fromBounds('2026-09-01', '2026-10-01')
    expect(contains(period, fromISO('2026-09-01'))).toBe(true)
    expect(contains(period, fromISO('2026-09-30'))).toBe(true)
    expect(contains(period, fromISO('2026-10-01'))).toBe(false)
    expect(() => fromBounds('2026-10-01', '2026-10-01')).toThrow(RangeError)
  })

  it('steps to the next and previous period', () => {
    const period = resolveCurrentPeriod({ today: fromISO('2026-09-14'), startDay: 25 })
    expect(toISO(nextPeriod(period, 25).start)).toBe('2026-09-25')
    expect(toISO(previousPeriod(period, 25).start)).toBe('2026-07-25')
    expect(periodKey(period)).toBe('2026-08-25')
  })

  it('labels a calendar month by name and any other period by its dates', () => {
    expect(formatPeriodLabel(fromBounds('2026-09-01', '2026-10-01'))).toBe('September 2026')
    expect(formatPeriodLabel(fromBounds('2026-08-25', '2026-09-25'))).toBe('25 Aug – 24 Sept 2026')
    expect(formatPeriodLabel(fromBounds('2026-12-25', '2027-01-25'))).toBe(
      '25 Dec 2026 – 24 Jan 2027',
    )
  })
})
