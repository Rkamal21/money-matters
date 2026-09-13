import { useQuery } from '@tanstack/react-query'
import { Lightbulb } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { GroupedBars, Sparkbars } from '@/components/charts/Bars'
import { CategoryDonut } from '@/components/charts/CategoryDonut'
import { CardSection } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { ProgressBar, StatusBadge } from '@/components/ui/Status'
import { useCategories, useCurrentPlan, useGoals, usePreferences, useToday } from '@/data/queries'
import { repositories } from '@/data/repositories'
import {
  calculateSavingsRate,
  compareToPreviousPeriod,
  netOfRefunds,
} from '@/domain/analytics/analytics'
import {
  calculateCategoryUsages,
  calculateOverallBudgetUsage,
} from '@/domain/budget/calculateBudgetUsage'
import { calculateGoalProgress } from '@/domain/goals/goals'
import {
  calculateFinancialHealthScore,
  scoreBudgetAdherence,
  scoreSavingsRate,
  scoreTrackingConsistency,
  scoreVolatility,
} from '@/domain/health/calculateFinancialHealthScore'
import { type Insight, RuleBasedInsightProvider } from '@/domain/insights/insights'
import { format } from '@/domain/money/format'
import { toChartValue } from '@/domain/money/Money'
import {
  daysElapsed,
  daysInPeriod,
  formatPeriodLabel,
  previousPeriod,
} from '@/domain/period/BudgetPeriod'
import { addDays, formatDate, toISO } from '@/domain/period/LocalDate'
import { aggregateByCategory } from '@/domain/transactions/aggregateByCategory'
import { netSpending } from '@/domain/transactions/PeriodSummary'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

/**
 * Analytics and insights — ROADMAP.md M8. Every chart ships a table for
 * screen readers, every number comes from a server aggregate, and nothing is
 * fabricated: without enough history, a card says so.
 */

type Range = '3' | '6' | '12'

const SEVERITY_TONE = { positive: 'positive', info: 'info', caution: 'caution' } as const

export function InsightsPage() {
  usePageTitle('Insights')
  const userId = useUserId()
  const today = useToday()
  const { currency, locale, budgetPeriodStartDay: startDay } = usePreferences()
  const plan = useCurrentPlan()
  const categories = useCategories()
  const goals = useGoals()
  const [range, setRange] = useState<Range>('6')

  const period = plan.data?.period ?? null
  const previous = period === null ? null : previousPeriod(period, startDay)

  const comparison = useQuery({
    queryKey: queryKeys.analytics('comparison', today ? toISO(today) : '', range),
    enabled: today !== null,
    queryFn: () => {
      if (today === null) throw new Error('today unknown')
      return repositories.analytics.monthlyComparison(today, Number(range), currency)
    },
  })

  const current = useQuery({
    queryKey: queryKeys.periodSummary(
      period ? toISO(period.start) : 'none',
      period ? toISO(period.endExclusive) : 'none',
    ),
    enabled: period !== null,
    queryFn: () => {
      if (period === null) throw new Error('no period')
      return repositories.analytics.periodSummary(period.start, period.endExclusive, currency)
    },
  })

  const prior = useQuery({
    queryKey: queryKeys.periodSummary(
      previous ? toISO(previous.start) : 'none',
      previous ? toISO(previous.endExclusive) : 'none',
    ),
    enabled: previous !== null,
    queryFn: () => {
      if (previous === null) throw new Error('no period')
      return repositories.analytics.periodSummary(previous.start, previous.endExclusive, currency)
    },
  })

  const daily = useQuery({
    queryKey: queryKeys.analytics('daily', today ? toISO(today) : ''),
    enabled: today !== null,
    queryFn: () => {
      if (today === null) throw new Error('today unknown')
      return repositories.analytics.spendingOverTime(
        addDays(today, -29),
        addDays(today, 1),
        'day',
        currency,
      )
    },
  })

  const weekly = useQuery({
    queryKey: queryKeys.analytics('weekly', today ? toISO(today) : ''),
    enabled: today !== null,
    queryFn: () => {
      if (today === null) throw new Error('today unknown')
      return repositories.analytics.spendingOverTime(
        addDays(today, -7 * 8),
        addDays(today, 1),
        'week',
        currency,
      )
    },
  })

  const limits = useQuery({
    queryKey: queryKeys.budget(`limits:${plan.data?.id ?? 'none'}`),
    enabled: plan.data !== undefined,
    queryFn: () => repositories.budgets.listLimits(userId, plan.data?.id ?? '', currency),
  })

  const usages = useMemo(() => {
    if (period === null || today === null || current.data === undefined) return []
    return calculateCategoryUsages({
      categories: categories.data ?? [],
      limits: new Map((limits.data ?? []).map((row) => [row.categoryId, row.limit])),
      totals: current.data.byCategory,
      currency,
      today,
      period,
    })
  }, [period, today, current.data, categories.data, limits.data, currency])

  const health = useMemo(() => {
    const summary = current.data
    if (summary === undefined || daily.data === undefined || weekly.data === undefined) return null
    const rate = calculateSavingsRate({ income: summary.income, expenses: netSpending(summary) })
    const limited = usages.filter((usage) => usage.status !== 'no_limit')
    const active = (goals.data ?? []).filter((goal) => goal.archivedAt === null)
    return calculateFinancialHealthScore({
      savingsRate: scoreSavingsRate(rate.status === 'ok' ? rate.rate : null),
      budgetAdherence: scoreBudgetAdherence(
        limited.filter((usage) => usage.status !== 'exceeded').length,
        limited.length,
      ),
      trackingConsistency: scoreTrackingConsistency(
        daily.data.filter((point) => point.expense.minor > 0n || point.income.minor > 0n).length,
      ),
      goalProgress:
        active.length === 0
          ? null
          : active.reduce((sum, goal) => sum + calculateGoalProgress(goal).displayRatio, 0) /
            active.length,
      spendingVolatility: scoreVolatility(
        weekly.data.map((point) => toChartValue(netOfRefunds(point.expense, point.refund))),
      ),
    })
  }, [current.data, daily.data, weekly.data, usages, goals.data])

  const insights = useQuery({
    queryKey: queryKeys.analytics(
      'insights',
      today ? toISO(today) : '',
      current.dataUpdatedAt,
      prior.dataUpdatedAt,
      usages.length,
    ),
    enabled:
      current.data !== undefined && period !== null && today !== null && plan.data !== undefined,
    queryFn: (): Promise<Insight[]> => {
      const summary = current.data
      if (summary === undefined || period === null || today === null || plan.data === undefined)
        return Promise.resolve([])
      const before = prior.data
      return RuleBasedInsightProvider.generate({
        currency,
        locale,
        elapsedRatio: daysElapsed(period, today) / daysInPeriod(period),
        current: {
          income: summary.income,
          spending: netSpending(summary),
          byCategory: summary.byCategory,
        },
        previous:
          before === undefined || before.transactionCount === 0
            ? null
            : {
                income: before.income,
                spending: netSpending(before),
                byCategory: before.byCategory,
              },
        categoryUsage: usages,
        overall: calculateOverallBudgetUsage({
          plan: plan.data,
          variableSpent: summary.variable,
          variableRefunded: summary.variableRefund,
          today,
          period,
        }),
        hasExpectedIncome: plan.data.expectedIncome.minor > 0n,
        goalsBehind: [],
      })
    },
  })

  const categoryChanges = useMemo(() => {
    if (current.data === undefined || prior.data === undefined) return []
    const before = new Map(prior.data.byCategory.map((row) => [row.categoryId, row]))
    return current.data.byCategory
      .filter((row) => row.kind === 'expense')
      .map((row) => {
        const previousRow = before.get(row.categoryId)
        const now = netOfRefunds(row.expense, row.refund)
        const then = previousRow ? netOfRefunds(previousRow.expense, previousRow.refund) : null
        return {
          row,
          now,
          then,
          change: then === null ? null : compareToPreviousPeriod({ current: now, previous: then }),
        }
      })
      .slice(0, 8)
  }, [current.data, prior.data])

  const breakdown = aggregateByCategory({
    totals: current.data?.byCategory ?? [],
    currency,
    top: 6,
  })

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Insights</h1>
        <p className="text-sm text-text-muted">
          How your money moves over time, and what stands out.
        </p>
      </header>

      <CardSection title="What stands out" titleId="insights-list">
        {insights.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : insights.isError ? (
          <ErrorState
            error={toAppError(insights.error)}
            onRetry={() => void insights.refetch()}
            compact
          />
        ) : (insights.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="size-6" />}
            title="Nothing to flag right now"
            body="Insights appear as patterns do."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(insights.data ?? []).map((insight) => (
              <li
                key={insight.id}
                className="flex flex-col gap-1.5 rounded-lg border border-border p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-text">{insight.title}</p>
                  <StatusBadge tone={SEVERITY_TONE[insight.severity]}>
                    {insight.severity === 'positive'
                      ? 'Good'
                      : insight.severity === 'caution'
                        ? 'Heads up'
                        : 'Tip'}
                  </StatusBadge>
                </div>
                <p className="text-sm text-text-muted">{insight.body}</p>
                {insight.action && (
                  <Link
                    to={insight.action.route}
                    className="text-sm font-medium text-brand hover:underline"
                  >
                    {insight.action.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardSection>

      <CardSection
        title="Income and spending"
        titleId="insights-comparison"
        action={
          <SegmentedControl
            legend="Months shown"
            value={range}
            options={[
              { value: '3', label: '3M' },
              { value: '6', label: '6M' },
              { value: '12', label: '1Y' },
            ]}
            onChange={setRange}
          />
        }
      >
        {comparison.isPending ? (
          <LoadingBlock label="Loading the comparison">
            <Skeleton className="h-52 w-full" />
          </LoadingBlock>
        ) : comparison.isError ? (
          <ErrorState
            error={toAppError(comparison.error)}
            onRetry={() => void comparison.refetch()}
            compact
          />
        ) : (
          <>
            <GroupedBars
              caption="Income and spending by financial month"
              series={[
                {
                  key: 'income',
                  label: 'Income',
                  fillClass: 'fill-positive',
                  swatchClass: 'bg-positive',
                },
                {
                  key: 'spending',
                  label: 'Spending',
                  fillClass: 'fill-brand',
                  swatchClass: 'bg-brand',
                },
              ]}
              groups={(comparison.data ?? []).map((month) => {
                const spending = netOfRefunds(month.expense, month.refund)
                return {
                  key: toISO(month.period.start),
                  label: formatDate(month.period.start, locale, { month: 'short' }),
                  values: [
                    {
                      series: 'income',
                      value: toChartValue(month.income),
                      text: format(month.income, locale),
                    },
                    {
                      series: 'spending',
                      value: toChartValue(spending),
                      text: format(spending, locale),
                    },
                  ],
                }
              })}
            />
            <ul className="mt-4 divide-y divide-border text-sm">
              {[...(comparison.data ?? [])]
                .reverse()
                .slice(0, 4)
                .map((month) => {
                  const spending = netOfRefunds(month.expense, month.refund)
                  const rate = calculateSavingsRate({ income: month.income, expenses: spending })
                  return (
                    <li
                      key={toISO(month.period.start)}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="text-text">{formatPeriodLabel(month.period, locale)}</span>
                      <span className="text-text-muted">
                        Kept{' '}
                        <span className="font-medium text-text tabular">
                          {rate.status === 'ok' ? `${Math.round(rate.rate * 100)}%` : '—'}
                        </span>
                      </span>
                    </li>
                  )
                })}
            </ul>
          </>
        )}
      </CardSection>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="Last 30 days" titleId="insights-daily">
          {daily.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : daily.isError ? (
            <ErrorState
              error={toAppError(daily.error)}
              onRetry={() => void daily.refetch()}
              compact
            />
          ) : (
            <>
              <Sparkbars
                caption="Spending per day over the last 30 days"
                points={(daily.data ?? []).map((point) => {
                  const net = netOfRefunds(point.expense, point.refund)
                  return {
                    key: toISO(point.bucket),
                    label: formatDate(point.bucket, locale),
                    value: toChartValue(net),
                    text: format(net, locale),
                  }
                })}
              />
              <p className="mt-2 text-xs text-text-muted">
                Each bar is a day; today is the dark one. Days with nothing are shown as zero.
              </p>
            </>
          )}
        </CardSection>

        <CardSection title="Financial health" titleId="insights-health">
          {health === null ? (
            <Skeleton className="h-32 w-full" />
          ) : health.status === 'insufficient_data' ? (
            <EmptyState
              title="Not enough to score yet"
              body="A score needs a few weeks of tracking and a budget. It never guesses."
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold text-text tabular">{health.score}</span>
                <span className="text-sm text-text-muted">out of 100</span>
                <StatusBadge
                  tone={
                    health.band === 'strong' || health.band === 'good'
                      ? 'positive'
                      : health.band === 'fair'
                        ? 'info'
                        : 'caution'
                  }
                >
                  {health.band === 'needs_attention'
                    ? 'Needs attention'
                    : health.band[0]?.toUpperCase() + health.band.slice(1)}
                </StatusBadge>
              </p>
              <ul className="flex flex-col gap-2">
                {health.components.map((component) => (
                  <li key={component.key} className="flex flex-col gap-1">
                    <p className="flex justify-between text-xs text-text-muted">
                      <span>{component.label}</span>
                      <span className="tabular">{component.score}</span>
                    </p>
                    <ProgressBar
                      ratio={component.score / 100}
                      tone={component.score >= 60 ? 'positive' : 'caution'}
                      label={`${component.label}: ${component.score} out of 100`}
                    />
                  </li>
                ))}
              </ul>
              <p className="rounded-lg bg-bg p-2.5 text-sm text-text">
                <span className="font-medium">Next step:</span> {health.weakest.explanation}
              </p>
            </div>
          )}
        </CardSection>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection
          title={period ? `Where it went · ${formatPeriodLabel(period, locale)}` : 'Where it went'}
          titleId="insights-breakdown"
        >
          {breakdown.slices.length === 0 ? (
            <EmptyState title="No spending this period yet" />
          ) : (
            <CategoryDonut
              ariaLabel={`Spending by category: ${breakdown.slices.map((slice) => `${slice.name} ${Math.round(slice.share * 100)}%`).join(', ')}`}
              centerLabel="Spent"
              centerValue={format(breakdown.total, locale)}
              slices={breakdown.slices.map((slice) => ({
                key: slice.categoryId,
                label: slice.name,
                share: slice.share,
                color: slice.color,
                valueText: <Money value={slice.net} locale={locale} />,
              }))}
            />
          )}
        </CardSection>

        <CardSection title="Against last period" titleId="insights-changes">
          {prior.isPending || current.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : categoryChanges.length === 0 || (prior.data?.transactionCount ?? 0) === 0 ? (
            <EmptyState
              title="Comparisons unlock next period"
              body="Once a full period is behind you, each category is compared with it here."
            />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">
                Spending by category, this period against last period
              </caption>
              <thead>
                <tr className="text-left text-xs text-text-muted">
                  <th scope="col" className="pb-2 font-medium">
                    Category
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Now
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {categoryChanges.map(({ row, now, change }) => (
                  <tr key={row.categoryId}>
                    <th scope="row" className="py-2 text-left font-normal text-text">
                      {row.name}
                    </th>
                    <td className="py-2 text-right">
                      <Money value={now} locale={locale} />
                    </td>
                    <td className="py-2 text-right tabular">
                      {change === null || change.status === 'no_data' ? (
                        <span className="text-text-muted">—</span>
                      ) : change.status === 'new' ? (
                        <span className="text-text-muted">New</span>
                      ) : (
                        <span
                          className={
                            change.direction === 'up'
                              ? 'text-caution'
                              : change.direction === 'down'
                                ? 'text-positive'
                                : 'text-text-muted'
                          }
                        >
                          {change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : ''}{' '}
                          {Math.abs(change.percent)}%
                          <span className="sr-only">
                            {change.direction === 'up'
                              ? ' more'
                              : change.direction === 'down'
                                ? ' less'
                                : ''}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardSection>
      </div>
    </div>
  )
}
