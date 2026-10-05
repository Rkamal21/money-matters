import type { LocalDate } from '../period/LocalDate'

import type { XpEventType } from './gamification'

/** `gamification_profiles` — read-only to the client (ADR-0016). */
export interface GamificationProfile {
  readonly xpTotal: number
  readonly currentStreak: number
  readonly longestStreak: number
  readonly lastCheckInOn: LocalDate | null
}

export interface Achievement {
  readonly code: string
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly xpReward: number
  readonly unlockedAt: string | null
}

/** One line of the XP ledger: the user can see exactly why they have the XP they have. */
export interface XpEvent {
  readonly id: string
  readonly type: XpEventType
  readonly xpAwarded: number
  readonly occurredOn: LocalDate
  readonly createdAt: string
}
