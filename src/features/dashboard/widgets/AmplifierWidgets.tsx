import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Flame, Lightbulb } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'
import { ProgressBar, StatusBadge } from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import { useCategories } from '@/data/queries'
import { repositories } from '@/data/repositories'
import {
  calculateCategoryUsages,
  calculateOverallBudgetUsage,
} from '@/domain/budget/calculateBudgetUsage'
import { progressToNextLevel } from '@/domain/gamification/gamification'
import { type FinancialSnapshot, RuleBasedInsightProvider } from '@/domain/insights/insights'
import { daysElapsed, daysInPeriod, previousPeriod } from '@/domain/period/BudgetPeriod'
import { equals, toISO } from '@/domain/period/LocalDate'
import { netSpending } from '@/domain/transactions/PeriodSummary'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'

import { WidgetFrame, type WidgetProps } from './WidgetFrame'

/**
 * The two amplifier widgets, behind their feature flags (PRODUCT.md §7).
 * Both sit below every financial number on the page: XP never appears above
 * a financial figure (PRODUCT.md §9).
 */

const SEVERITY_TONE = { positive: 'positive', info: 'info', caution: 'caution' } as const

export function InsightsWidget({ state }: WidgetProps) {
  const categories = useCategories()
  const { snapshot, today, locale, currency, startDay } = state
  const plan = snapshot?.plan ?? null

  const previous = plan === null ? null : previousPeriod(plan.period, startDay)
  const previousSummary = useQuery({
    queryKey: queryKeys.periodSummary(
      previous ? toISO(previous.start) : 'none',
      previous ? toISO(previous.endExclusive) : 'none',
    ),
    enabled: previous !== null,
    queryFn: () => {
      if (previous === null) throw new Error('no previous period')
      return repositories.analytics.periodSummary(previous.start, previous.endExclusive, currency)
    },
  })

  const financial = useMemo<FinancialSnapshot | null>(() => {
    if (snapshot === undefined || today === null || plan === null || snapshot.summary === null)
      return null
    const summary = snapshot.summary
    const prior = previousSummary.data
    return {
      currency,
      locale,
      elapsedRatio: daysElapsed(plan.period, today) / daysInPeriod(plan.period),
      current: {
        income: summary.income,
        spending: netSpending(summary),
        byCategory: summary.byCategory,
      },
      previous:
        prior === undefined || prior.transactionCount === 0
          ? null
          : { income: prior.income, spending: netSpending(prior), byCategory: prior.byCategory },
      categoryUsage: calculateCategoryUsages({
        categories: categories.data ?? [],
        limits: snapshot.limits,
        totals: summary.byCategory,
        currency,
        today,
        period: plan.period,
      }),
      overall: calculateOverallBudgetUsage({
        plan,
        variableSpent: summary.variable,
        variableRefunded: summary.variableRefund,
        today,
        period: plan.period,
      }),
      hasExpectedIncome: plan.expectedIncome.minor > 0n,
      goalsBehind: [],
    }
  }, [snapshot, today, plan, previousSummary.data, categories.data, currency, locale])

  const insights = useQuery({
    queryKey: queryKeys.analytics(
      'insights-widget',
      today ? toISO(today) : '',
      snapshot?.summary?.transactionCount ?? 0,
      previousSummary.dataUpdatedAt,
    ),
    enabled: financial !== null,
    queryFn: () => {
      if (financial === null) throw new Error('no snapshot')
      return RuleBasedInsightProvider.generate(financial)
    },
  })

  return (
    <WidgetFrame
      id="insights"
      title="Insights"
      state={state}
      action={
        <Link to="/insights" className="text-sm font-medium text-brand hover:underline">
          More
        </Link>
      }
    >
      {() =>
        insights.data === undefined || insights.data.length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="size-6" />}
            title="Nothing to flag"
            body="Keep tracking — patterns show up here as they appear."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {insights.data.slice(0, 3).map((insight) => (
              <li
                key={insight.id}
                className="flex flex-col gap-1 rounded-lg border border-border p-3"
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
        )
      }
    </WidgetFrame>
  )
}

export function StreakWidget({ state }: WidgetProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { snapshot, today } = state
  const profile = snapshot?.gamification ?? null
  const checkedInToday =
    profile?.lastCheckInOn != null && today !== null && equals(profile.lastCheckInOn, today)

  const checkIn = useMutation({
    mutationFn: () => {
      if (today === null) throw new Error('today unknown')
      return repositories.gamification.checkIn(today)
    },
    onSuccess: async () => {
      toast.show({ tone: 'success', title: 'Checked in', body: 'Streak kept. See you tomorrow.' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.gamification() }),
      ])
    },
    onError: (error) => toast.show({ tone: 'error', title: toAppError(error).userMessage }),
  })

  return (
    <WidgetFrame
      id="streak"
      title="Your streak"
      state={state}
      action={
        <Link to="/progress" className="text-sm font-medium text-brand hover:underline">
          Progress
        </Link>
      }
    >
      {() => {
        if (profile === null) return <EmptyState title="Progress unavailable" />
        const level = progressToNextLevel(profile.xpTotal)
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-11 items-center justify-center rounded-full bg-caution/12 text-caution"
              >
                <Flame className="size-6" />
              </span>
              <div>
                <p className="text-lg font-semibold text-text">
                  {profile.currentStreak} {profile.currentStreak === 1 ? 'day' : 'days'}
                </p>
                <p className="text-xs text-text-muted">Longest: {profile.longestStreak}</p>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <p className="flex justify-between text-xs text-text-muted">
                <span>Level {level.level}</span>
                <span className="tabular">
                  {level.current}/{level.needed} XP
                </span>
              </p>
              <ProgressBar ratio={level.ratio} label={`Level ${level.level} progress`} />
            </div>
            <Button
              variant={checkedInToday ? 'secondary' : 'primary'}
              disabled={checkedInToday}
              loading={checkIn.isPending}
              icon={<CalendarCheck aria-hidden="true" className="size-4" />}
              onClick={() => checkIn.mutate()}
            >
              {checkedInToday ? 'Checked in today' : 'Check in for today'}
            </Button>
          </div>
        )
      }}
    </WidgetFrame>
  )
}
