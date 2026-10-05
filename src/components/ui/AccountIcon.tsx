import { Banknote, CreditCard, Landmark, type LucideIcon, PiggyBank, Wallet } from 'lucide-react'
import { createElement } from 'react'

import type { AccountType } from '@/domain/transactions/types'
import { cn } from '@/lib/cn'

import { identityOf, identityTile } from './identity'

export const ACCOUNT_TYPE_LABEL: Readonly<Record<AccountType, string>> = {
  cash: 'Cash',
  bank: 'Bank',
  savings: 'Savings',
  wallet: 'Wallet',
  credit_card: 'Credit card',
}

const ACCOUNT_TYPE_ICON: Readonly<Record<AccountType, LucideIcon>> = {
  cash: Banknote,
  bank: Landmark,
  savings: PiggyBank,
  wallet: Wallet,
  credit_card: CreditCard,
}

/**
 * An account's tile: its type as the glyph, a stable identity colour from its
 * id. Decorative — the account's name and type are always written beside it.
 */
export function AccountIcon({
  type,
  identityKey,
  size = 'md',
  className,
}: {
  readonly type: AccountType
  readonly identityKey: string
  readonly size?: 'sm' | 'md'
  readonly className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        size === 'sm' ? 'size-9 rounded-lg' : 'size-11 rounded-xl',
        identityTile(identityOf(identityKey)),
        className,
      )}
    >
      {createElement(ACCOUNT_TYPE_ICON[type], {
        'aria-hidden': true,
        className: size === 'sm' ? 'size-4' : 'size-5',
      })}
    </span>
  )
}
