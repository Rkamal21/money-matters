import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Split } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Money as MoneyValue } from '@/domain/money/Money'
import type { Direction } from '@/domain/transactions/types'
import { cn } from '@/lib/cn'

import { CategoryIcon } from './CategoryIcon'
import { Money } from './Money'

/**
 * One ledger line, shared by the dashboard, the transaction list and a goal's
 * activity. Presentation only: the caller decides the direction with
 * `domain/transactions/directionOf` and passes the amount as it is.
 *
 * A transfer between the user's own accounts is shown without a sign and in a
 * neutral colour — it is neither income nor spending (ADR-0017).
 */
export function TransactionRow({
  title,
  subtitle,
  amount,
  direction,
  icon,
  color,
  isTransfer = false,
  isSplit = false,
  trailing,
  locale,
}: {
  readonly title: string
  readonly subtitle?: ReactNode
  readonly amount: MoneyValue
  readonly direction: Direction
  readonly icon?: string | null
  readonly color?: string | null
  readonly isTransfer?: boolean
  readonly isSplit?: boolean
  readonly trailing?: ReactNode
  readonly locale?: string
}) {
  const DirectionIcon =
    direction === 'in' ? ArrowDownLeft : direction === 'out' ? ArrowUpRight : ArrowLeftRight
  return (
    <div className="flex min-h-[4.375rem] items-center gap-3 py-3">
      {isTransfer ? (
        <span
          aria-hidden="true"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-muted"
        >
          <ArrowLeftRight className="size-5" />
        </span>
      ) : (
        <CategoryIcon icon={icon} color={color} />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-text">
          <span className="truncate">{title}</span>
          {isSplit && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1 text-[0.6875rem] text-text-muted">
              <Split aria-hidden="true" className="size-3" />
              Split
            </span>
          )}
        </p>
        {subtitle && <p className="truncate text-xs text-text-muted">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-right">
        <DirectionIcon
          aria-hidden="true"
          className={cn(
            'size-3.5',
            direction === 'in'
              ? 'text-positive'
              : direction === 'out'
                ? 'text-text-muted'
                : 'text-text-muted',
          )}
        />
        <Money
          value={amount}
          {...(locale === undefined ? {} : { locale })}
          tone={direction === 'in' ? 'positive' : 'default'}
          {...(direction === 'in' ? { sign: 'always' as const } : {})}
          className="text-sm font-semibold"
        />
        <span className="sr-only">
          {direction === 'in' ? 'in' : direction === 'out' ? 'out' : 'moved between your accounts'}
        </span>
      </div>
      {trailing}
    </div>
  )
}
