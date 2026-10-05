import {
  compare,
  divideCeil,
  isPositive,
  max,
  min,
  multiplyByRatio,
  ratio,
  subtract,
  sumAll,
  type Money,
  zero,
} from '../money/Money'
import { addDays, compare as compareDates, daysBetween, type LocalDate } from '../period/LocalDate'

/**
 * Goals — FINANCIAL-ENGINE.md §5, ADR-0026.
 *
 * A goal is the purpose of one wallet. Every input here is that wallet's
 * slice of the ledger: `balance` from `account_balances`, `reached` from
 * `goal_progress`, `entries` from `account_entries`. Nothing about progress is
 * stored, so nothing here can disagree with the balances widget.
 */

export type GoalStatus = 'active' | 'achieved' | 'archived'

/** Status is derived: archived beats achieved beats active (DATABASE.md §6.8). */
export function goalStatus(input: {
  readonly archivedAt: string | null
  readonly reached: boolean
}): GoalStatus {
  if (input.archivedAt !== null) return 'archived'
  return input.reached ? 'achieved' : 'active'
}

export interface GoalProgress {
  /** Raw balance / target. May exceed 1; may be negative. */
  readonly progressRatio: number
  /** Clamped 0..1, for the progress bar. */
  readonly displayRatio: number
  /** max(0, target − balance) */
  readonly remaining: Money
  /** = reached. Sticky: spending the money on its purpose does not un-achieve it. */
  readonly isAchieved: boolean
}

export function calculateGoalProgress(input: {
  readonly target: Money
  readonly balance: Money
  readonly reached: boolean
}): GoalProgress {
  const progressRatio = ratio(input.balance, input.target) ?? 0
  return {
    progressRatio,
    displayRatio: Math.min(1, Math.max(0, progressRatio)),
    remaining: max(zero(input.target.currency), subtract(input.target, input.balance)),
    isAchieved: input.reached,
  }
}

export type GoalPlanStatus = 'on_track' | 'behind' | 'achieved' | 'overdue' | 'no_target_date'

export interface GoalPlan {
  /** Days until the target date, counting today. `null` without a date. */
  readonly daysRemaining: number | null
  readonly requiredPerDay: Money | null
  readonly requiredPerWeek: Money | null
  readonly requiredPerMonth: Money | null
  readonly status: GoalPlanStatus
}

/**
 * What it takes to get there by the target date. Required amounts round UP —
 * an under-estimate of what you need to save is the optimistic mistake
 * (FINANCIAL-ENGINE.md §1.3). With a known saving rate, "behind" means that
 * rate will not get there in time.
 */
export function calculateGoalPlan(input: {
  readonly target: Money
  readonly balance: Money
  readonly reached: boolean
  readonly targetDate: LocalDate | null
  readonly today: LocalDate
  readonly ratePerDay?: Money | null
}): GoalPlan {
  const none = { requiredPerDay: null, requiredPerWeek: null, requiredPerMonth: null }

  if (input.reached) {
    return {
      daysRemaining:
        input.targetDate === null ? null : daysBetween(input.today, input.targetDate) + 1,
      ...none,
      status: 'achieved',
    }
  }
  if (input.targetDate === null) return { daysRemaining: null, ...none, status: 'no_target_date' }

  const remaining = max(zero(input.target.currency), subtract(input.target, input.balance))

  if (compareDates(input.targetDate, input.today) < 0) {
    return { daysRemaining: 0, ...none, status: 'overdue' }
  }

  const days = daysBetween(input.today, input.targetDate) + 1
  const requiredPerDay = divideCeil(remaining, BigInt(days))
  const requiredPerWeek = min(
    remaining,
    divideCeil(multiplyByRatio(remaining, 7n, 1n), BigInt(days)),
  )
  const requiredPerMonth = min(
    remaining,
    divideCeil(multiplyByRatio(remaining, 30n, 1n), BigInt(days)),
  )

  const rate = input.ratePerDay ?? null
  const behind = rate !== null && compare(rate, requiredPerDay) < 0

  return {
    daysRemaining: days,
    requiredPerDay,
    requiredPerWeek,
    requiredPerMonth,
    status: behind ? 'behind' : 'on_track',
  }
}

export interface WalletEntry {
  readonly occurredOn: LocalDate
  /** Signed: + into the wallet, − out of it. */
  readonly amount: Money
}

export type GoalProjection =
  | {
      readonly status: 'projected'
      readonly date: LocalDate
      readonly ratePerDay: Money
      readonly confidence: 'low' | 'medium' | 'high'
    }
  | { readonly status: 'achieved' }
  | {
      readonly status: 'no_projection'
      readonly reason: 'no_activity' | 'net_negative_rate' | 'too_few_points'
    }

/**
 * When the goal will be reached at the recent rate. Refuses to invent a date:
 * one inflow is not a rate, and a net outflow never arrives
 * (ROADMAP.md M6: "a projection with insufficient data says so").
 */
export function projectGoalCompletion(input: {
  readonly target: Money
  readonly balance: Money
  readonly reached: boolean
  readonly entries: readonly WalletEntry[]
  readonly today: LocalDate
  readonly windowDays?: number
}): GoalProjection {
  if (input.reached || compare(input.balance, input.target) >= 0) return { status: 'achieved' }

  const windowDays = input.windowDays ?? 90
  const windowStart = addDays(input.today, -(windowDays - 1))
  const inWindow = input.entries.filter(
    (entry) =>
      compareDates(entry.occurredOn, windowStart) >= 0 &&
      compareDates(entry.occurredOn, input.today) <= 0,
  )

  if (inWindow.length === 0) return { status: 'no_projection', reason: 'no_activity' }
  if (inWindow.length < 2) return { status: 'no_projection', reason: 'too_few_points' }

  const net = sumAll(
    inWindow.map((entry) => entry.amount),
    input.target.currency,
  )
  if (!isPositive(net)) return { status: 'no_projection', reason: 'net_negative_rate' }

  const first = inWindow.reduce(
    (earliest, entry) =>
      compareDates(entry.occurredOn, earliest) < 0 ? entry.occurredOn : earliest,
    input.today,
  )
  const span = Math.max(1, daysBetween(first, input.today) + 1)
  const ratePerDay = divideCeil(net, BigInt(span))

  const remaining = subtract(input.target, input.balance)
  // Ceil the days: "you'll get there in 41 days" must not be optimistic either.
  const daysToGo = Number((remaining.minor * BigInt(span) + net.minor - 1n) / net.minor)

  const distinctDays = new Set(inWindow.map((entry) => daysBetween(first, entry.occurredOn))).size
  const confidence = distinctDays >= 6 && span >= 30 ? 'high' : distinctDays >= 3 ? 'medium' : 'low'

  return { status: 'projected', date: addDays(input.today, daysToGo), ratePerDay, confidence }
}
