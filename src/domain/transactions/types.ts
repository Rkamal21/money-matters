import type { Money } from '../money/Money'
import type { LocalDate } from '../period/LocalDate'

/**
 * Ledger entities as the domain sees them. The repository layer builds these
 * from rows; no feature ever sees `amount_minor` (API.md §3 rule 2).
 */

export type TransactionKind = 'expense' | 'income' | 'transfer' | 'refund'
export type AccountType = 'cash' | 'bank' | 'savings' | 'wallet' | 'credit_card'
export type CategoryKind = 'expense' | 'income'
export type CategoryTreatment = 'fixed' | 'variable' | 'excluded'

export interface Account {
  readonly id: string
  readonly name: string
  readonly type: AccountType
  readonly currency: string
  readonly openingBalance: Money
  readonly creditLimit: Money | null
  readonly institution: string | null
  readonly last4: string | null
  readonly isArchived: boolean
  readonly position: number
  readonly updatedAt: string
}

export interface AccountWithBalance extends Account {
  readonly balance: Money
}

export interface Category {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly kind: CategoryKind
  readonly treatment: CategoryTreatment
  readonly icon: string
  readonly color: string
  readonly isSystem: boolean
  readonly isArchived: boolean
  readonly position: number
}

export interface TransactionSplit {
  readonly id: string
  readonly categoryId: string
  readonly amount: Money
  readonly note: string | null
}

export interface Transaction {
  readonly id: string
  readonly kind: TransactionKind
  readonly amount: Money
  readonly accountId: string
  readonly counterAccountId: string | null
  readonly categoryId: string | null
  readonly merchantLabel: string | null
  readonly description: string
  readonly notes: string | null
  readonly occurredOn: LocalDate
  readonly isSplit: boolean
  readonly splits: readonly TransactionSplit[]
  readonly refundOfTransactionId: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly deletedAt: string | null
}

/** The category kind a transaction kind files under. Transfers have none. */
export function categoryKindFor(kind: TransactionKind): CategoryKind | null {
  switch (kind) {
    case 'income':
      return 'income'
    case 'expense':
    case 'refund':
      return 'expense'
    case 'transfer':
      return null
  }
}

export type Direction = 'in' | 'out' | 'neutral'

/**
 * Which way money moved, from one account's point of view — or, with no
 * account given, from the user's: a transfer between their own accounts is
 * neither in nor out, which is the whole point of ADR-0017.
 */
export function directionOf(
  transaction: Pick<Transaction, 'kind' | 'accountId' | 'counterAccountId'>,
  perspectiveAccountId?: string,
): Direction {
  switch (transaction.kind) {
    case 'income':
    case 'refund':
      return 'in'
    case 'expense':
      return 'out'
    case 'transfer':
      if (perspectiveAccountId === undefined) return 'neutral'
      if (perspectiveAccountId === transaction.counterAccountId) return 'in'
      if (perspectiveAccountId === transaction.accountId) return 'out'
      return 'neutral'
  }
}

/** "Owed" on a credit card is the negated balance; available credit is limit + balance. */
export function isLiability(type: AccountType): boolean {
  return type === 'credit_card'
}
