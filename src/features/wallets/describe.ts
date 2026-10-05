import { type Direction, directionOf, type Transaction } from '@/domain/transactions/types'

/**
 * How a ledger line reads in a wallet's list: a title, the line under it,
 * and which way the money went *for the wallet being looked at* — a transfer
 * into it is money in, the same transfer seen from the other side is out.
 */

const KIND_LABEL = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  refund: 'Refund',
} as const

interface Named {
  readonly name: string
}

interface CategoryLike extends Named {
  readonly icon: string | null
  readonly color: string | null
}

export interface Lookups {
  readonly categories: ReadonlyMap<string, CategoryLike>
  readonly accounts: ReadonlyMap<string, Named>
}

export interface Described {
  readonly title: string
  readonly subtitle: string
  readonly direction: Direction
  readonly icon: string | null
  readonly color: string | null
}

export function describeTransaction(
  row: Transaction,
  lookups: Lookups,
  viewAccountId?: string,
): Described {
  const category = row.categoryId === null ? undefined : lookups.categories.get(row.categoryId)
  const accountName = lookups.accounts.get(row.accountId)?.name ?? 'Account'
  const counterName =
    row.counterAccountId === null
      ? 'Account'
      : (lookups.accounts.get(row.counterAccountId)?.name ?? 'Account')
  const direction = directionOf(row, viewAccountId)

  if (row.kind === 'transfer') {
    if (viewAccountId === undefined) {
      return {
        title: row.description || 'Transfer',
        subtitle: `${accountName} → ${counterName}`,
        direction,
        icon: null,
        color: null,
      }
    }
    const other = row.accountId === viewAccountId ? counterName : accountName
    return {
      title: row.description || (direction === 'in' ? `From ${other}` : `To ${other}`),
      subtitle: 'Moved between your accounts',
      direction,
      icon: null,
      color: null,
    }
  }

  const title = row.merchantLabel || row.description || category?.name || KIND_LABEL[row.kind]
  const parts: string[] = []
  if (viewAccountId === undefined) parts.push(accountName)
  if (category !== undefined && title !== category.name) parts.push(category.name)
  if (row.isSplit) parts.push('Split')
  if (row.kind === 'refund') parts.push('Refund')
  return {
    title,
    subtitle: parts.join(' · '),
    direction,
    icon: category?.icon ?? null,
    color: category?.color ?? null,
  }
}
