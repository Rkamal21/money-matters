import { ArrowRight, Info, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { HeroShapes } from '@/components/ui/HeroShapes'
import { Money } from '@/components/ui/Money'
import { ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { StatusBadge, type Tone } from '@/components/ui/Status'
import {
  actualsFromSummary,
  calculateSafeDailyLimit,
  type SafeDailyLimitResult,
} from '@/domain/budget/calculateSafeDailyLimit'
import { abs, isNegative, isZero, zero } from '@/domain/money/Money'
import { formatPeriodLabel } from '@/domain/period/BudgetPeriod'
import { netVariable } from '@/domain/transactions/PeriodSummary'
import { cn } from '@/lib/cn'

import type { WidgetProps } from './WidgetFrame'

/**
 * The hero number (PRODUCT.md §2: "the only number that converts
 * understanding into a decision a person can act on before lunch").
 *
 * Zero arithmetic here. The widget renders a `SafeDailyLimitResult`; the
 * thirteen steps that produce it live in `domain/budget` and nowhere else.
 */

const STATUS: Readonly<Record<'ok' | 'tight' | 'comfortable', { tone: Tone; label: string }>> = {
  comfortable: { tone: 'positive', label: 'Comfortable' },
  ok: { tone: 'info', label: 'On track' },
  tight: { tone: 'caution', label: 'Tight' },
}

export function SafeDailyLimitWidget({ state }: WidgetProps) {
  const { snapshot, today, locale, currency } = state

  const result = useMemo<SafeDailyLimitResult | null>(() => {
    if (snapshot === undefined || today === null) return null
    if (snapshot.plan === null || snapshot.summary === null) {
      return { status: 'insufficient_data', missing: ['budget_period'] }
    }
    const { plan } = snapshot
    return calculateSafeDailyLimit({
      period: plan.period,
      today,
      plan: {
        expectedIncome: plan.expectedIncome,
        plannedFixed: plan.plannedFixed,
        plannedSavings: plan.plannedSavings,
        rolloverIn: plan.rolloverIn,
        overallLimit: plan.overallLimit,
      },
      actuals: actualsFromSummary(snapshot.summary, netVariable(snapshot.todaySummary)),
      upcomingPlanned: zero(currency),
      locale,
    })
  }, [snapshot, today, locale, currency])

  return (
    <section
      aria-labelledby="widget-safe-daily-limit"
      // The reference design's dark balance card, holding the one hero number.
      className="theme-inverse relative overflow-hidden rounded-3xl p-5 shadow-overlay sm:p-6"
    >
      <HeroShapes />
      <div className="relative">
        <h2 id="widget-safe-daily-limit" className="pr-24 text-sm font-medium text-text-muted">
          Safe to spend today
        </h2>
        {state.error !== null && snapshot === undefined ? (
          <div className="mt-3">
            <ErrorState error={state.error} onRetry={state.retry} compact />
          </div>
        ) : result === null ? (
          <LoadingBlock label="Working out your safe daily limit">
            <Skeleton className="mt-3 h-12 w-48" />
            <Skeleton className="mt-3 h-4 w-64" />
          </LoadingBlock>
        ) : (
          <SafeDailyLimitBody result={result} locale={locale} />
        )}
      </div>
    </section>
  )
}

function SafeDailyLimitBody({
  result,
  locale,
}: {
  readonly result: SafeDailyLimitResult
  readonly locale: string
}) {
  switch (result.status) {
    case 'insufficient_data':
      // Never lie by omission: no income is "set up your budget", not ₹0/day (PRODUCT.md §4.2).
      return (
        <div className="mt-2 flex flex-col items-start gap-3">
          <p className="text-2xl font-semibold text-text">Set up your budget</p>
          <p className="max-w-md text-sm text-text-muted">
            Tell us what you expect to earn this period and we will work out a daily amount you can
            safely spend — and show exactly how we got there.
          </p>
          <Link
            to="/budget"
            className="inline-flex h-11 items-center rounded-lg bg-brand-strong px-4 text-sm font-semibold text-on-brand hover:bg-brand-strong/90"
          >
            Plan this period
          </Link>
        </div>
      )
    case 'period_ended':
      return (
        <div className="mt-2">
          <p className="text-2xl font-semibold text-text">This period has ended</p>
          <p className="mt-1 text-sm text-text-muted">
            {formatPeriodLabel(result.period, locale)} is closed. Your new period starts fresh.
          </p>
        </div>
      )
    case 'overspent':
      return (
        <div className="mt-2 flex flex-col gap-3">
          <p className="flex items-center gap-2 text-3xl font-semibold text-negative">
            <TriangleAlert aria-hidden="true" className="size-7 shrink-0" />
            <span>
              Over by <Money value={result.overspentBy} locale={locale} />
            </span>
          </p>
          <p className="text-sm text-text-muted">
            {result.explanation} This is advice, not a lock — nothing is blocked. Easing off for the
            rest of the period brings it back.
          </p>
          <Breakdown result={result} locale={locale} />
          <BudgetLink />
        </div>
      )
    case 'ok':
    case 'tight':
    case 'comfortable': {
      const status = STATUS[result.status]
      const today = result.today
      return (
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <p className="flex items-baseline gap-1 text-text">
              <Money
                value={result.limit}
                locale={locale}
                className="text-4xl font-semibold tracking-tight sm:text-5xl"
              />
              <span className="text-base text-text-muted">/ day</span>
            </p>
            <StatusBadge tone={status.tone} className="mb-1.5">
              {status.label}
            </StatusBadge>
          </div>
          <p className="text-sm text-text-muted">{result.explanation}</p>
          {today !== null && (
            <p
              className={cn(
                'flex items-center gap-1.5 text-sm font-medium',
                isNegative(today.left) ? 'text-negative' : 'text-text',
              )}
            >
              {isNegative(today.left) ? (
                <>
                  <TriangleAlert aria-hidden="true" className="size-4" />
                  <span>
                    Today is <Money value={abs(today.left)} locale={locale} /> over its share of{' '}
                    <Money value={today.allowance} locale={locale} />
                  </span>
                </>
              ) : isZero(today.spent) ? (
                <span>Nothing spent yet today.</span>
              ) : (
                <span>
                  <Money value={today.left} locale={locale} /> left today, of{' '}
                  <Money value={today.allowance} locale={locale} />
                </span>
              )}
            </p>
          )}
          <Breakdown result={result} locale={locale} />
          <BudgetLink />
        </div>
      )
    }
  }
}

/** The reference's round arrow button, as a link to the plan behind the number. */
function BudgetLink() {
  return (
    <Link
      to="/budget"
      className="inline-flex min-h-11 items-center gap-2 self-end rounded-full text-sm font-medium text-text"
    >
      Open budget
      <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-strong text-on-brand">
        <ArrowRight aria-hidden="true" className="size-4" />
      </span>
    </Link>
  )
}

/** "Here's why" — the number without its breakdown is a number people stop believing (PRODUCT.md §4.1). */
function Breakdown({
  result,
  locale,
}: {
  readonly result: Extract<SafeDailyLimitResult, { breakdown: unknown }>
  readonly locale: string
}) {
  return (
    <details className="group rounded-xl border border-border bg-bg">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
        <Info aria-hidden="true" className="size-4" />
        Why this number?
      </summary>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 px-3 pb-3 text-sm">
        {result.breakdown.map((line) => (
          <div key={line.key} className={cn('contents', line.sign === '=' && 'font-semibold')}>
            <dt
              className={cn(
                'text-text-muted',
                line.sign === '=' && 'border-t border-border pt-1.5 text-text',
              )}
            >
              {line.label}
            </dt>
            <dd className={cn('text-right', line.sign === '=' && 'border-t border-border pt-1.5')}>
              <span aria-hidden="true" className="mr-1 text-text-muted">
                {line.sign === '=' ? '' : line.sign}
              </span>
              <span className="sr-only">
                {line.sign === '+' ? 'plus' : line.sign === '−' ? 'minus' : 'equals'}
              </span>
              <Money value={line.amount} locale={locale} />
            </dd>
          </div>
        ))}
        <dt className="text-text-muted">Days left, including today</dt>
        <dd className="text-right tabular">{result.daysRemaining}</dd>
      </dl>
      <p className="px-3 pb-3 text-xs text-text-muted">
        Transfers between your accounts and categories marked “excluded” never count. Rounded down,
        so the advice is never optimistic.
      </p>
    </details>
  )
}
