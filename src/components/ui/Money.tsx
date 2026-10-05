import { format, type FormatOptions, toSpokenLabel } from '@/domain/money/format'
import type { Money as MoneyValue } from '@/domain/money/Money'
import { cn } from '@/lib/cn'

/**
 * Money on screen: tabular digits so columns align and nothing jitters as a
 * value updates, and a spoken form for screen readers — "one thousand two
 * hundred rupees" rather than "rupee sign one comma two zero zero"
 * (ARCHITECTURE.md §F.6).
 *
 * Renders; never computes. Any arithmetic behind the value happened in
 * `domain/`.
 */
export type MoneyTone = 'default' | 'muted' | 'positive' | 'negative' | 'brand'

const TONES: Readonly<Record<MoneyTone, string>> = {
  default: '',
  muted: 'text-text-muted',
  positive: 'text-positive',
  negative: 'text-negative',
  brand: 'text-brand',
}

export function Money({
  value,
  locale = 'en-IN',
  tone = 'default',
  sign,
  fraction,
  className,
}: {
  readonly value: MoneyValue
  readonly locale?: string
  readonly tone?: MoneyTone
  readonly sign?: FormatOptions['sign']
  readonly fraction?: FormatOptions['fraction']
  readonly className?: string
}) {
  const options: FormatOptions = {
    ...(sign === undefined ? {} : { sign }),
    ...(fraction === undefined ? {} : { fraction }),
  }
  const spoken = toSpokenLabel(value, locale)
  const signed = sign === 'always' && value.minor > 0n ? `plus ${spoken}` : spoken
  return (
    <span className={cn('tabular whitespace-nowrap', TONES[tone], className)}>
      <span aria-hidden="true">{format(value, locale, options)}</span>
      <span className="sr-only">{signed}</span>
    </span>
  )
}
