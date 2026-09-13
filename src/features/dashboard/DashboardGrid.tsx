import type { ComponentType } from 'react'

import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { type Flag, FLAGS } from '@/config/flags'
import { useProfile } from '@/data/queries'
import { cn } from '@/lib/cn'

import type { DashboardState } from './hooks/useDashboard'
import { InsightsWidget, StreakWidget } from './widgets/AmplifierWidgets'
import { SafeDailyLimitWidget } from './widgets/SafeDailyLimitWidget'
import {
  BalancesWidget,
  BudgetStatusWidget,
  GoalsWidget,
  MonthSummaryWidget,
  RecentTransactionsWidget,
  SpendingBreakdownWidget,
} from './widgets/SummaryWidgets'
import type { WidgetProps } from './widgets/WidgetFrame'

/**
 * The dashboard is a registry, not a component (PRODUCT.md §7): adding,
 * removing or reordering a widget is a change to this array. Priority order is
 * the mobile order — on a 360 px screen the safe daily limit comes first,
 * because that is the question the app was opened to answer.
 */
interface WidgetEntry {
  readonly id: string
  readonly span: 'full' | 'half'
  readonly component: ComponentType<WidgetProps>
  readonly flag?: Flag
}

export const DASHBOARD_WIDGETS: readonly WidgetEntry[] = [
  { id: 'safe-daily-limit', span: 'full', component: SafeDailyLimitWidget },
  { id: 'budget-status', span: 'full', component: BudgetStatusWidget },
  { id: 'balances', span: 'half', component: BalancesWidget },
  { id: 'month-summary', span: 'half', component: MonthSummaryWidget },
  { id: 'spending-breakdown', span: 'full', component: SpendingBreakdownWidget },
  { id: 'goals', span: 'half', component: GoalsWidget },
  { id: 'recent-transactions', span: 'half', component: RecentTransactionsWidget },
  { id: 'insights', span: 'half', component: InsightsWidget, flag: 'insights' },
  { id: 'streak', span: 'half', component: StreakWidget, flag: 'gamification' },
]

export function DashboardGrid({ state }: { readonly state: DashboardState }) {
  const gamificationEnabled = useProfile().data?.gamificationEnabled ?? false

  const visible = DASHBOARD_WIDGETS.filter((widget) => {
    if (widget.flag === undefined) return true
    if (!FLAGS[widget.flag]) return false
    return widget.flag !== 'gamification' || gamificationEnabled
  })

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {visible.map((widget) => (
        <div key={widget.id} className={cn('min-w-0', widget.span === 'full' && 'lg:col-span-2')}>
          {/* One widget's failure degrades to an inline error; the rest render. */}
          <ErrorBoundary title="This card could not be shown" compact>
            <widget.component state={state} />
          </ErrorBoundary>
        </div>
      ))}
    </div>
  )
}
