import { daysBetween, formatDate, type LocalDate } from './LocalDate'

/**
 * Human labels for civil dates. "Today" and "Yesterday" are computed against
 * the user's own today — never the device's UTC date.
 */
export function relativeDayLabel(date: LocalDate, today: LocalDate, locale = 'en-IN'): string {
  const offset = daysBetween(date, today)
  if (offset === 0) return 'Today'
  if (offset === 1) return 'Yesterday'
  if (offset === -1) return 'Tomorrow'
  const sameYear = date.y === today.y
  return formatDate(
    date,
    locale,
    sameYear
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  )
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>()

/** "morning" | "afternoon" | "evening" in the user's zone, for a greeting. */
export function partOfDay(epochMs: number, timeZone: string): 'morning' | 'afternoon' | 'evening' {
  let formatter = hourFormatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
    hourFormatters.set(timeZone, formatter)
  }
  const hour = Number(
    formatter.formatToParts(epochMs).find((part) => part.type === 'hour')?.value ?? '12',
  )
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  return 'evening'
}
