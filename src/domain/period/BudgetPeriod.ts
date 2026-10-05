import {
  addDays,
  addMonths,
  compare,
  daysBetween,
  formatDate,
  fromISO,
  type LocalDate,
  of,
  toISO,
} from './LocalDate'

/**
 * The user's financial month — FINANCIAL-ENGINE.md §2.2.
 *
 * Half-open, `[start, endExclusive)`, like the `daterange` it mirrors in
 * `budget_periods`. Someone paid on the 25th gets 25 Aug → 24 Sep, which is
 * what their money actually does; the calendar month is the special case
 * `startDay = 1`.
 *
 * `startDay` is 1–28 so every month contains it. The alternative — clamping
 * day 31 to "the last day" — makes periods of surprising, unequal length and
 * an off-by-one every February.
 */
export interface BudgetPeriod {
  readonly start: LocalDate
  readonly endExclusive: LocalDate
}

export function assertStartDay(startDay: number): void {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28) {
    throw new RangeError('The period start day must be a whole number from 1 to 28.')
  }
}

export function resolvePeriodContaining(input: {
  readonly date: LocalDate
  readonly startDay: number
}): BudgetPeriod {
  assertStartDay(input.startDay)
  let start = of(input.date.y, input.date.m, input.startDay)
  if (compare(start, input.date) > 0) start = addMonths(start, -1)
  return { start, endExclusive: addMonths(start, 1) }
}

/** The period "today" is in. */
export function resolveCurrentPeriod(input: {
  readonly today: LocalDate
  readonly startDay: number
}): BudgetPeriod {
  return resolvePeriodContaining({ date: input.today, startDay: input.startDay })
}

export function nextPeriod(period: BudgetPeriod, startDay: number): BudgetPeriod {
  return resolvePeriodContaining({ date: period.endExclusive, startDay })
}

export function previousPeriod(period: BudgetPeriod, startDay: number): BudgetPeriod {
  return resolvePeriodContaining({ date: addDays(period.start, -1), startDay })
}

export function daysInPeriod(period: BudgetPeriod): number {
  return daysBetween(period.start, period.endExclusive)
}

export function contains(period: BudgetPeriod, date: LocalDate): boolean {
  return compare(date, period.start) >= 0 && compare(date, period.endExclusive) < 0
}

/**
 * Days left, counting today. On the last day it is 1, never 0 — the last
 * day's allowance is everything that is left. Before the period starts it is
 * the whole period; after it ends it is 0.
 */
export function daysRemaining(period: BudgetPeriod, today: LocalDate): number {
  if (compare(today, period.start) < 0) return daysInPeriod(period)
  if (compare(today, period.endExclusive) >= 0) return 0
  return daysBetween(today, period.endExclusive)
}

/**
 * Whole days gone before today — the complement of `daysRemaining`, so the
 * two always sum to the period's length. 0 on the first day and before the
 * period; the whole period after it.
 */
export function daysElapsed(period: BudgetPeriod, today: LocalDate): number {
  return daysInPeriod(period) - daysRemaining(period, today)
}

export function hasEnded(period: BudgetPeriod, today: LocalDate): boolean {
  return compare(today, period.endExclusive) >= 0
}

/** The last day inside the period. */
export function lastDay(period: BudgetPeriod): LocalDate {
  return addDays(period.endExclusive, -1)
}

/** Stable key for URLs and cache keys: the ISO start date, `2026-09-01`. */
export function periodKey(period: BudgetPeriod): string {
  return toISO(period.start)
}

export function fromBounds(startISO: string, endExclusiveISO: string): BudgetPeriod {
  const start = fromISO(startISO)
  const endExclusive = fromISO(endExclusiveISO)
  if (compare(start, endExclusive) >= 0) {
    throw new RangeError('A period must end after it starts.')
  }
  return { start, endExclusive }
}

/**
 * "September 2026" for a calendar month; "25 Aug – 24 Sep 2026" otherwise.
 * The label is formatted here rather than stored, because PostgreSQL will not
 * put `to_char` in a generated column (DATABASE.md §6.6).
 */
export function formatPeriodLabel(period: BudgetPeriod, locale = 'en-IN'): string {
  const last = lastDay(period)
  const isCalendarMonth =
    period.start.d === 1 && period.endExclusive.d === 1 && daysInPeriod(period) >= 28
  if (isCalendarMonth) {
    return formatDate(period.start, locale, { month: 'long', year: 'numeric' })
  }
  const sameYear = period.start.y === last.y
  const from = formatDate(
    period.start,
    locale,
    sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  )
  const to = formatDate(last, locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${from} – ${to}`
}
