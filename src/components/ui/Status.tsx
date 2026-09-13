import { CircleAlert, CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import type { BudgetStatus } from '@/domain/budget/calculateBudgetUsage'
import { cn } from '@/lib/cn'

/**
 * Colour is never the only signal: over budget is red AND an icon AND a word
 * (ARCHITECTURE.md §F.5 rule 3).
 */
export type Tone = 'positive' | 'caution' | 'negative' | 'info' | 'neutral'

const TONE_TEXT: Readonly<Record<Tone, string>> = {
  positive: 'text-positive',
  caution: 'text-caution',
  negative: 'text-negative',
  info: 'text-brand',
  neutral: 'text-text-muted',
}

const TONE_BG: Readonly<Record<Tone, string>> = {
  positive: 'bg-positive/10 text-positive',
  caution: 'bg-caution/12 text-caution',
  negative: 'bg-negative/10 text-negative',
  info: 'bg-brand/10 text-brand',
  neutral: 'bg-surface-2 text-text-muted',
}

const TONE_ICON = {
  positive: CircleCheck,
  caution: TriangleAlert,
  negative: CircleX,
  info: Info,
  neutral: CircleAlert,
} as const

export function toneText(tone: Tone): string {
  return TONE_TEXT[tone]
}

export function StatusBadge({
  tone,
  children,
  className,
}: {
  readonly tone: Tone
  readonly children: ReactNode
  readonly className?: string
}) {
  const Icon = TONE_ICON[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONE_BG[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </span>
  )
}

export function Badge({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

const BUDGET_TONE: Readonly<Record<BudgetStatus, Tone>> = {
  no_limit: 'neutral',
  ok: 'positive',
  approaching: 'caution',
  at_limit: 'caution',
  exceeded: 'negative',
}

export const BUDGET_STATUS_LABEL: Readonly<Record<BudgetStatus, string>> = {
  no_limit: 'No limit',
  ok: 'Within limit',
  approaching: 'Approaching',
  at_limit: 'At limit',
  exceeded: 'Over limit',
}

export function budgetStatusTone(status: BudgetStatus): Tone {
  return BUDGET_TONE[status]
}

/** A budget status as colour AND icon AND word. */
export function BudgetStatusBadge({
  status,
  className,
}: {
  readonly status: BudgetStatus
  readonly className?: string
}) {
  return (
    <StatusBadge tone={BUDGET_TONE[status]} {...(className === undefined ? {} : { className })}>
      {BUDGET_STATUS_LABEL[status]}
    </StatusBadge>
  )
}

const BAR: Readonly<Record<Tone, string>> = {
  positive: 'bg-positive',
  caution: 'bg-caution',
  negative: 'bg-negative',
  info: 'bg-brand',
  neutral: 'bg-text-muted',
}

/**
 * A progress bar with a real `progressbar` role. `ratio` is display-only and
 * clamped here; a value over 1 shows a full bar and the caller says "over".
 */
export function ProgressBar({
  ratio,
  label,
  tone = 'info',
  marker,
  fillClassName,
  className,
}: {
  readonly ratio: number
  readonly label: string
  readonly tone?: Tone
  /** Optional 0..1 position of a tick, e.g. how far through the period we are. */
  readonly marker?: number | null
  /** An identity fill (components/ui/identity) instead of a status tone. */
  readonly fillClassName?: string
  readonly className?: string
}) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0))
  const percent = Math.round(clamped * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-200',
          fillClassName ?? BAR[tone],
        )}
        style={{ width: `${percent}%` }}
      />
      {marker !== undefined && marker !== null && (
        <div
          aria-hidden="true"
          className="absolute top-0 h-full w-0.5 bg-text/50"
          style={{ left: `${Math.round(Math.min(1, Math.max(0, marker)) * 100)}%` }}
        />
      )}
    </div>
  )
}
