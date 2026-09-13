import type { Money } from '../money/Money'
import type { LocalDate } from '../period/LocalDate'

/**
 * A goal and its derived progress. The goal row names a purpose and a target;
 * the amount saved is its wallet's balance, read from `goal_progress`
 * (ADR-0026). There is no second number to disagree with the ledger.
 */
export interface Goal {
  readonly id: string
  readonly name: string
  readonly walletAccountId: string
  readonly target: Money
  readonly targetDate: LocalDate | null
  readonly priority: number
  readonly archivedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface GoalWithProgress extends Goal {
  /** The wallet's balance: the amount saved. */
  readonly balance: Money
  /** Sticky: true once the wallet's balance has ever met the target. */
  readonly reached: boolean
  readonly reachedOn: LocalDate | null
}
