import { useQuery } from '@tanstack/react-query'

import { useCurrentPlan, usePreferences, useToday } from '@/data/queries'
import { type DashboardSnapshot, repositories } from '@/data/repositories'
import type { AppError } from '@/domain/errors/AppError'
import { toISO, type LocalDate } from '@/domain/period/LocalDate'
import { AppErrorException, toAppError, unexpectedError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'

/**
 * The whole dashboard in one round trip — `get_dashboard_snapshot`
 * (DATABASE.md §11) — after `ensure_budget_period` has made sure this
 * period exists. Widgets read slices of this; none fetches on its own.
 */
export interface DashboardState {
  readonly snapshot: DashboardSnapshot | undefined
  readonly isPending: boolean
  readonly error: AppError | null
  readonly retry: () => void
  readonly today: LocalDate | null
  readonly locale: string
  readonly currency: string
  readonly startDay: number
}

export function useDashboard(): DashboardState {
  const today = useToday()
  const preferences = usePreferences()
  const plan = useCurrentPlan()

  const snapshot = useQuery({
    queryKey: queryKeys.dashboard(today === null ? 'pending' : toISO(today)),
    enabled: today !== null && plan.isSuccess,
    queryFn: () => {
      if (today === null) throw new AppErrorException(unexpectedError('today unknown'))
      return repositories.analytics.dashboardSnapshot(today, preferences.currency)
    },
  })

  const error = plan.error ?? snapshot.error
  return {
    snapshot: snapshot.data,
    isPending: plan.isPending || snapshot.isPending,
    error: error === null ? null : toAppError(error),
    retry: () => {
      void plan.refetch()
      void snapshot.refetch()
    },
    today,
    locale: preferences.locale,
    currency: preferences.currency,
    startDay: preferences.budgetPeriodStartDay,
  }
}
