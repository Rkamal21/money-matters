/**
 * LocalDate — a civil date with no time and no zone. FINANCIAL-ENGINE.md §2.1.
 *
 * Arithmetic here is calendar arithmetic on a day count, so daylight saving
 * cannot touch it: there is no 23-hour day when there are no hours.
 *
 * `fromInstant` is the single place in the whole system where a timezone is
 * applied to an instant. v1's bug was exactly this conversion done by string
 * slicing a UTC timestamp, which made "today" yesterday for every Indian user
 * between 00:00 and 05:30.
 *
 * No `Date` object appears in this file: instants arrive as epoch
 * milliseconds and are formatted by `Intl`, which accepts a number.
 */

export interface LocalDate {
  readonly y: number
  /** 1–12 */
  readonly m: number
  readonly d: number
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function lengthOfMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31
}

export function isValid(y: number, m: number, d: number): boolean {
  return (
    Number.isInteger(y) &&
    Number.isInteger(m) &&
    Number.isInteger(d) &&
    y >= 1 &&
    y <= 9999 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= lengthOfMonth(y, m)
  )
}

export function of(y: number, m: number, d: number): LocalDate {
  if (!isValid(y, m, d)) throw new RangeError(`${y}-${m}-${d} is not a calendar date.`)
  return Object.freeze({ y, m, d })
}

export function tryFromISO(text: string): LocalDate | null {
  const match = ISO.exec(text)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  return isValid(y, m, d) ? Object.freeze({ y, m, d }) : null
}

export function fromISO(text: string): LocalDate {
  const date = tryFromISO(text)
  if (date === null) throw new RangeError(`"${text}" is not an ISO date (YYYY-MM-DD).`)
  return date
}

/** "2026-09-07" — exactly what the database stores in a `date` column. */
export function toISO(date: LocalDate): string {
  return `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
}

/**
 * Days since 1970-01-01. Howard Hinnant's `days_from_civil`: integer
 * arithmetic only, correct for every Gregorian date.
 */
export function toEpochDay(date: LocalDate): number {
  const y = date.m <= 2 ? date.y - 1 : date.y
  const era = Math.floor(y / 400)
  const yearOfEra = y - era * 400
  const shiftedMonth = (date.m + 9) % 12
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + date.d - 1
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

export function fromEpochDay(epochDay: number): LocalDate {
  const z = epochDay + 719468
  const era = Math.floor(z / 146097)
  const dayOfEra = z - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  )
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153)
  const d = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1
  const m = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9
  const y = yearOfEra + era * 400 + (m <= 2 ? 1 : 0)
  return Object.freeze({ y, m, d })
}

const MS_PER_DAY = 86_400_000

/** Milliseconds at 00:00 UTC on this date — for handing to an `Intl` formatter pinned to UTC. */
export function toUtcEpochMs(date: LocalDate): number {
  return toEpochDay(date) * MS_PER_DAY
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * The civil date an instant falls on in a timezone.
 *
 * `formatToParts` rather than `getTimezoneOffset()` arithmetic, because the
 * offset of a zone is not constant (DST) and not always whole hours
 * (Asia/Kolkata +5:30, Pacific/Chatham +12:45).
 */
export function fromInstant(epochMs: number, timeZone: string): LocalDate {
  let formatter = zoneFormatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      calendar: 'gregory',
      numberingSystem: 'latn',
    })
    zoneFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(epochMs)
  const read = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((part) => part.type === type)?.value)
  return of(read('year'), read('month'), read('day'))
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days)
}

/**
 * Calendar months, clamping the day: 31 Jan + 1 month = 28 Feb (29 in a leap
 * year). Budget periods never hit the clamp, because `startDay` ≤ 28.
 */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const index = date.y * 12 + (date.m - 1) + months
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return of(y, m, Math.min(date.d, lengthOfMonth(y, m)))
}

/** `b − a` in days. Positive when b is later. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return toEpochDay(b) - toEpochDay(a)
}

export function compare(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  const difference = toEpochDay(a) - toEpochDay(b)
  return difference < 0 ? -1 : difference > 0 ? 1 : 0
}

export function equals(a: LocalDate, b: LocalDate): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d
}

export function isBefore(a: LocalDate, b: LocalDate): boolean {
  return compare(a, b) < 0
}

export function isAfter(a: LocalDate, b: LocalDate): boolean {
  return compare(a, b) > 0
}

export function min(a: LocalDate, b: LocalDate): LocalDate {
  return isBefore(b, a) ? b : a
}

export function max(a: LocalDate, b: LocalDate): LocalDate {
  return isAfter(b, a) ? b : a
}

export function startOfMonth(date: LocalDate): LocalDate {
  return of(date.y, date.m, 1)
}

export function endOfMonth(date: LocalDate): LocalDate {
  return of(date.y, date.m, lengthOfMonth(date.y, date.m))
}

/** 0 = Monday … 6 = Sunday. 1970-01-01 was a Thursday. */
export function dayOfWeek(date: LocalDate): number {
  return (((toEpochDay(date) + 3) % 7) + 7) % 7
}

const labelFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * Format a civil date for display: `formatDate(d, 'en-IN', { day: 'numeric', month: 'short' })`.
 * The formatter is pinned to UTC and given UTC midnight, so no zone can move
 * the date it prints.
 */
export function formatDate(
  date: LocalDate,
  locale = 'en-IN',
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = labelFormatters.get(key)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
    labelFormatters.set(key, formatter)
  }
  return formatter.format(toUtcEpochMs(date))
}

export const LocalDate = {
  of,
  fromISO,
  tryFromISO,
  toISO,
  fromInstant,
  toEpochDay,
  fromEpochDay,
  addDays,
  addMonths,
  daysBetween,
  compare,
  equals,
  isBefore,
  isAfter,
  min,
  max,
  startOfMonth,
  endOfMonth,
  lengthOfMonth,
  isLeapYear,
  dayOfWeek,
  formatDate,
} as const
