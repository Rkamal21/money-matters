import { useProfile } from '@/data/queries'
import { daysRemaining, formatPeriodLabel } from '@/domain/period/BudgetPeriod'
import { partOfDay } from '@/domain/period/labels'
import { usePageTitle } from '@/hooks/usePageTitle'
import { systemClock } from '@/lib/clock'

import { DashboardGrid } from '../DashboardGrid'
import { useDashboard } from '../hooks/useDashboard'

export function DashboardPage() {
  usePageTitle('Dashboard')
  const profile = useProfile().data
  const state = useDashboard()
  const plan = state.snapshot?.plan ?? null
  const name = profile?.displayName.trim() ?? ''
  const greeting = `Good ${partOfDay(systemClock.nowEpochMs(), state.locale === '' ? 'Asia/Kolkata' : (profile?.timezone ?? 'Asia/Kolkata'))}`
  const left =
    plan !== null && state.today !== null ? daysRemaining(plan.period, state.today) : null

  return (
    <div className="flex flex-col gap-6">
      {/* The reference's greeting: a small line, then the name. */}
      <header className="flex items-center justify-between gap-3">
        <h1 className="flex min-w-0 flex-col">
          <span className="text-sm font-normal text-text-muted">{greeting}!</span>{' '}
          <span className="truncate text-2xl font-semibold tracking-tight text-text">
            {name !== '' ? name : 'Welcome back'}
          </span>
        </h1>
        {plan !== null && left !== null && (
          <p className="shrink-0 rounded-full border border-card-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted shadow-card">
            <span className="sr-only">{formatPeriodLabel(plan.period, state.locale)}: </span>
            {left} {left === 1 ? 'day' : 'days'} left
          </p>
        )}
      </header>
      <DashboardGrid state={state} />
    </div>
  )
}
