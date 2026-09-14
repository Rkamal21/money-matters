import { fromInstant, type LocalDate } from './LocalDate'

/**
 * The only way time enters `domain/` (ADR-0006, TESTING.md §3.2).
 *
 * `Date.now()` and `new Date()` are lint-banned in this directory. The real
 * clock lives in `lib/clock.ts`; tests hand in a fixed one. A calculation that
 * read the ambient clock could not be tested at a month boundary, and month
 * boundaries are where finance apps break.
 */
export interface Clock {
  /** Milliseconds since the epoch — an instant, not a date. */
  nowEpochMs(): number
}

/** "Today" for a user: the civil date, in their timezone, of the clock's instant. */
export function today(clock: Clock, timeZone: string): LocalDate {
  return fromInstant(clock.nowEpochMs(), timeZone)
}

/** A clock that always reads the same instant. For tests and storybook-style fixtures. */
export function fixedClock(epochMs: number): Clock {
  return { nowEpochMs: () => epochMs }
}
