import { daysBetween, type LocalDate } from '../period/LocalDate'

/**
 * Gamification rules — FINANCIAL-ENGINE.md §6.
 *
 * All XP is awarded server-side (ADR-0016). These functions only *predict*
 * what the server will do, so the UI can explain it; the numbers here are
 * mirrored by the `award_xp` calls in 20260910121500_gamification_awards.sql,
 * and that mirror is the one genuine duplication in the design
 * (ARCHITECTURE.md §R.5).
 */

export const XP_PER_LEVEL = 100

/** Level 1 at 0 XP; one level per 100 XP. There is no stored level to disagree with. */
export function levelForXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1
}

export function xpForLevel(level: number): number {
  return (Math.max(1, level) - 1) * XP_PER_LEVEL
}

export function progressToNextLevel(xp: number): {
  readonly level: number
  readonly current: number
  readonly needed: number
  readonly ratio: number
} {
  const level = levelForXp(xp)
  const current = Math.max(0, xp) - xpForLevel(level)
  return { level, current, needed: XP_PER_LEVEL, ratio: current / XP_PER_LEVEL }
}

export type StreakReason = 'first' | 'same_day' | 'continued' | 'reset' | 'invalid'

/**
 * The streak transition table. v1's bug lived here: it compared a UTC date
 * string with a timestamptz. Both sides are civil dates now.
 */
export function nextStreak(input: {
  readonly lastCheckInOn: LocalDate | null
  readonly today: LocalDate
  readonly current: number
}): { readonly streak: number; readonly changed: boolean; readonly reason: StreakReason } {
  if (input.lastCheckInOn === null) return { streak: 1, changed: true, reason: 'first' }

  const gap = daysBetween(input.lastCheckInOn, input.today)
  if (gap < 0) return { streak: input.current, changed: false, reason: 'invalid' }
  if (gap === 0) return { streak: input.current, changed: false, reason: 'same_day' }
  if (gap === 1) return { streak: input.current + 1, changed: true, reason: 'continued' }
  return { streak: 1, changed: true, reason: 'reset' }
}

export type XpEventType =
  | 'transaction_logged'
  | 'daily_check_in'
  | 'goal_contribution'
  | 'goal_achieved'
  | 'budget_reviewed'
  | 'period_under_budget'
  | 'achievement_unlocked'
  | 'adjustment'

/**
 * The XP catalog, product-owned. Outcomes are worth more than activity —
 * finishing under budget is ten logged transactions — and the daily caps
 * stop "log 200 one-rupee expenses" being the optimal strategy.
 */
export const XP_RULES: readonly {
  readonly type: XpEventType
  readonly label: string
  readonly xp: number | 'varies'
  readonly cap: string
}[] = [
  { type: 'transaction_logged', label: 'Log a transaction', xp: 5, cap: 'up to 5 a day' },
  { type: 'daily_check_in', label: 'Daily check-in', xp: 10, cap: 'once a day' },
  { type: 'goal_contribution', label: 'Move money into a goal', xp: 15, cap: 'up to 10 a day' },
  { type: 'budget_reviewed', label: 'Review your budget plan', xp: 5, cap: 'once a period' },
  {
    type: 'period_under_budget',
    label: 'Finish a period under budget',
    xp: 50,
    cap: 'once a period',
  },
  { type: 'goal_achieved', label: 'Reach a goal', xp: 100, cap: 'once per goal' },
  { type: 'achievement_unlocked', label: 'Unlock an achievement', xp: 'varies', cap: 'once each' },
]

export function xpEventLabel(type: XpEventType): string {
  if (type === 'adjustment') return 'Adjustment'
  return XP_RULES.find((rule) => rule.type === type)?.label ?? type
}
