import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { z } from 'zod'

import { Button, IconButton } from '@/components/ui/Button'
import { Card, CardSection } from '@/components/ui/Card'
import { CategoryIcon } from '@/components/ui/CategoryIcon'
import { AmountInput, Field } from '@/components/ui/Field'
import { Money } from '@/components/ui/Money'
import { Switch } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import {
  BudgetStatusBadge,
  budgetStatusTone,
  ProgressBar,
  StatusBadge,
} from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import {
  useCategories,
  useCurrentPlan,
  useInvalidateLedger,
  usePreferences,
  useToday,
} from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { BudgetPlan } from '@/domain/budget/BudgetPlan'
import {
  calculateCategoryUsages,
  calculateOverallBudgetUsage,
  type CategoryUsage,
} from '@/domain/budget/calculateBudgetUsage'
import { calculateAvailable } from '@/domain/budget/calculateSafeDailyLimit'
import type { AppError } from '@/domain/errors/AppError'
import { divideFloor, type Money as MoneyValue, toMajorString, zero } from '@/domain/money/Money'
import {
  type BudgetPeriod,
  daysInPeriod,
  formatPeriodLabel,
  nextPeriod,
  previousPeriod,
  resolvePeriodContaining,
} from '@/domain/period/BudgetPeriod'
import { compare, toISO, tryFromISO } from '@/domain/period/LocalDate'
import { actualsFromSummary } from '@/domain/budget/calculateSafeDailyLimit'
import { netSpending, type PeriodSummary } from '@/domain/transactions/PeriodSummary'
import type { Category } from '@/domain/transactions/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { amountField, toMoney, toMoneyOrNull } from '@/lib/forms'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

/**
 * The budget engine's screen — ROADMAP.md M4.
 *
 *   - One plan per financial period, with full history: editing September
 *     never touches August.
 *   - A budget is a plan; transactions are facts. Editing the plan changes the
 *     derived numbers and never a transaction (FINANCIAL-ENGINE.md §4.2).
 *   - A closed period is read-only (the RLS policy refuses the write anyway).
 */

export function BudgetPage() {
  usePageTitle('Budget')
  const userId = useUserId()
  const today = useToday()
  const { currency, locale, budgetPeriodStartDay: startDay } = usePreferences()
  const [params, setParams] = useSearchParams()
  const current = useCurrentPlan()
  const categories = useCategories()

  const requested = tryFromISO(params.get('period') ?? '')
  const currentPeriod = current.data?.period ?? null
  const viewing: BudgetPeriod | null =
    requested !== null ? resolvePeriodContaining({ date: requested, startDay }) : currentPeriod
  const isCurrent =
    viewing !== null && currentPeriod !== null && compare(viewing.start, currentPeriod.start) === 0

  const other = useQuery({
    queryKey: queryKeys.budget(viewing ? `at:${toISO(viewing.start)}` : 'none'),
    enabled: viewing !== null && !isCurrent,
    queryFn: () => {
      if (viewing === null) throw new Error('no period')
      return repositories.budgets.getContaining(userId, viewing.start, currency)
    },
  })
  const plan: BudgetPlan | null = isCurrent ? (current.data ?? null) : (other.data ?? null)
  const period: BudgetPeriod | null = plan?.period ?? viewing

  const summary = useQuery({
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

  const limits = useQuery({
    queryKey: queryKeys.budget(`limits:${plan?.id ?? 'none'}`),
    enabled: plan !== null,
    queryFn: () => repositories.budgets.listLimits(userId, plan?.id ?? '', currency),
  })

  const history = useQuery({
    queryKey: queryKeys.budgetPeriods(),
    queryFn: () => repositories.budgets.listPeriods(userId, currency, 12),
  })

  const limitMap = useMemo(
    () => new Map((limits.data ?? []).map((row) => [row.categoryId, row.limit])),
    [limits.data],
  )

  const usages = useMemo<CategoryUsage[]>(() => {
    if (period === null || today === null || summary.data === undefined) return []
    return calculateCategoryUsages({
      categories: (categories.data ?? []).filter(
        (category) => !category.isArchived || limitMap.has(category.id),
      ),
      limits: limitMap,
      totals: summary.data.byCategory,
      currency,
      today,
      period,
    })
  }, [period, today, summary.data, categories.data, limitMap, currency])

  const goTo = (target: BudgetPeriod) => {
    const isToday = currentPeriod !== null && compare(target.start, currentPeriod.start) === 0
    setParams(isToday ? {} : { period: toISO(target.start) })
  }

  const canGoNext =
    period !== null && currentPeriod !== null && compare(period.start, currentPeriod.start) < 0
  const loading = current.isPending || (!isCurrent && other.isPending)
  const error = current.error ?? other.error

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Budget</h1>
          <p className="text-sm text-text-muted">
            A plan for each financial month. History is kept, period by period.
          </p>
        </div>
        {period !== null && (
          <nav
            aria-label="Budget period"
            className="flex items-center gap-1 rounded-xl border border-border bg-surface p-1"
          >
            <IconButton
              label="Previous period"
              onClick={() => goTo(previousPeriod(period, startDay))}
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </IconButton>
            <p
              className="min-w-40 px-2 text-center text-sm font-medium text-text"
              aria-live="polite"
            >
              {formatPeriodLabel(period, locale)}
            </p>
            <IconButton
              label="Next period"
              disabled={!canGoNext}
              onClick={() => goTo(nextPeriod(period, startDay))}
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </IconButton>
          </nav>
        )}
      </header>

      {error ? (
        <ErrorState
          error={toAppError(error)}
          onRetry={() => void Promise.all([current.refetch(), other.refetch()])}
        />
      ) : loading || period === null ? (
        <LoadingBlock label="Loading your budget">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </LoadingBlock>
      ) : (
        <>
          {plan === null ? (
            <Card>
              <EmptyState
                title="No budget was set for this period"
                body="Periods get a plan when you open the app during them. The spending below is still exact."
              />
            </Card>
          ) : (
            <PlanCard
              plan={plan}
              currency={currency}
              locale={locale}
              summary={summary.data ?? null}
            />
          )}

          <CardSection title="Categories" titleId="budget-categories">
            {summary.isPending ? (
              <LoadingBlock label="Loading category spending">
                <Skeleton className="h-40 w-full" />
              </LoadingBlock>
            ) : summary.isError ? (
              <ErrorState
                error={toAppError(summary.error)}
                onRetry={() => void summary.refetch()}
                compact
              />
            ) : (
              <CategoryList
                usages={usages}
                plan={plan}
                summary={summary.data ?? null}
                allCategories={(categories.data ?? []).filter(
                  (category) => category.kind === 'expense' && !category.isArchived,
                )}
                currency={currency}
                locale={locale}
              />
            )}
          </CardSection>

          {history.data && history.data.length > 1 && (
            <CardSection title="History" titleId="budget-history">
              <ul className="divide-y divide-border">
                {history.data.map((row) => (
                  <li key={row.id}>
                    <Link
                      to={
                        isCurrentRow(row, currentPeriod)
                          ? '/budget'
                          : `/budget?period=${toISO(row.period.start)}`
                      }
                      className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-2 text-sm hover:bg-surface-2"
                    >
                      <span className="font-medium text-text">
                        {formatPeriodLabel(row.period, locale)}
                      </span>
                      <span className="flex items-center gap-2 text-text-muted">
                        Income plan <Money value={row.expectedIncome} locale={locale} />
                        {row.closedAt !== null && <StatusBadge tone="neutral">Closed</StatusBadge>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardSection>
          )}
        </>
      )}
    </div>
  )
}

function isCurrentRow(row: BudgetPlan, current: BudgetPeriod | null): boolean {
  return current !== null && compare(row.period.start, current.start) === 0
}

// ---------------------------------------------------------------------------

const planSchema = z.object({
  expectedIncome: amountField({ allowZero: true }),
  plannedFixed: amountField({ allowZero: true }),
  plannedSavings: amountField({ allowZero: true }),
  overallLimit: amountField({ allowZero: true, required: false }),
  rolloverEnabled: z.boolean(),
})

type PlanValues = z.infer<typeof planSchema>

function PlanCard({
  plan,
  currency,
  locale,
  summary,
}: {
  readonly plan: BudgetPlan
  readonly currency: string
  readonly locale: string
  readonly summary: PeriodSummary | null
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const invalidateLedger = useInvalidateLedger()
  const closed = plan.closedAt !== null
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<PlanValues>({
    resolver: zodResolver(planSchema),
    values: {
      expectedIncome: toMajorString(plan.expectedIncome),
      plannedFixed: toMajorString(plan.plannedFixed),
      plannedSavings: toMajorString(plan.plannedSavings),
      overallLimit: plan.overallLimit === null ? '' : toMajorString(plan.overallLimit),
      rolloverEnabled: plan.rolloverEnabled,
    },
  })
  const { errors, isDirty } = form.formState

  const save = useMutation({
    mutationFn: (values: PlanValues) =>
      repositories.budgets.updatePlan(
        plan.id,
        {
          expectedIncome: toMoney(values.expectedIncome, currency),
          plannedFixed: toMoney(values.plannedFixed, currency),
          plannedSavings: toMoney(values.plannedSavings, currency),
          overallLimit: toMoneyOrNull(values.overallLimit, currency),
          rolloverEnabled: values.rolloverEnabled,
        },
        currency,
        plan.updatedAt,
      ),
    onSuccess: async () => {
      setServerError(null)
      toast.show({
        tone: 'success',
        title: 'Plan saved',
        body: 'Your safe daily limit has been recalculated.',
      })
      await Promise.all([
        invalidateLedger(),
        queryClient.invalidateQueries({ queryKey: queryKeys.budgetPeriods() }),
      ])
    },
    onError: (error) => setServerError(toAppError(error)),
  })

  const available = summary
    ? calculateAvailable({
        plan,
        actuals: actualsFromSummary(summary),
        upcomingPlanned: zero(currency),
      }).available
    : null
  const perDayPlan =
    available !== null && available.minor > 0n
      ? divideFloor(available, BigInt(daysInPeriod(plan.period))).quotient
      : null
  const spent = summary ? netSpending(summary) : null

  return (
    <CardSection
      title="Plan"
      titleId="budget-plan"
      action={
        closed ? (
          <StatusBadge tone="neutral">
            <Lock aria-hidden="true" className="size-3" /> Closed
          </StatusBadge>
        ) : undefined
      }
    >
      {closed && (
        <p className="mb-4 rounded-lg bg-surface-2 p-3 text-sm text-text-muted">
          This period has ended. Its plan is kept as history and can no longer be edited.
        </p>
      )}
      {(available !== null || spent !== null) && (
        <dl className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-bg p-3 sm:grid-cols-3">
          {available !== null && (
            <div>
              <dt className="text-xs text-text-muted">For day-to-day spending</dt>
              <dd>
                <Money
                  value={available}
                  locale={locale}
                  className="font-semibold"
                  tone={available.minor < 0n ? 'negative' : 'default'}
                />
              </dd>
            </div>
          )}
          {perDayPlan !== null && (
            <div>
              <dt className="text-xs text-text-muted">An even spread</dt>
              <dd>
                <Money value={perDayPlan} locale={locale} className="font-semibold" />{' '}
                <span className="text-xs text-text-muted">/ day</span>
              </dd>
            </div>
          )}
          {spent !== null && (
            <div>
              <dt className="text-xs text-text-muted">Spent this period</dt>
              <dd>
                <Money value={spent} locale={locale} className="font-semibold" />
              </dd>
            </div>
          )}
          {plan.rolloverIn.minor !== 0n && (
            <div>
              <dt className="text-xs text-text-muted">Carried from last period</dt>
              <dd>
                <Money
                  value={plan.rolloverIn}
                  locale={locale}
                  sign="always"
                  className="font-semibold"
                  tone={plan.rolloverIn.minor < 0n ? 'negative' : 'positive'}
                />
              </dd>
            </div>
          )}
        </dl>
      )}
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
        className="flex flex-col gap-4"
      >
        {serverError && <ErrorState error={serverError} title="Not saved" compact />}
        <fieldset disabled={closed} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="sr-only">This period’s plan</legend>
          <Field
            label="Expected income"
            hint="What you expect to land this period."
            error={errors.expectedIncome?.message}
          >
            {(control) => <AmountInput {...control} {...form.register('expectedIncome')} />}
          </Field>
          <Field
            label="Fixed costs"
            hint="Rent, EMIs, subscriptions."
            error={errors.plannedFixed?.message}
          >
            {(control) => <AmountInput {...control} {...form.register('plannedFixed')} />}
          </Field>
          <Field
            label="Savings"
            hint="Paid to yourself first."
            error={errors.plannedSavings?.message}
          >
            {(control) => <AmountInput {...control} {...form.register('plannedSavings')} />}
          </Field>
          <Field
            label="Spending cap"
            optional
            hint="An upper limit on day-to-day spending."
            error={errors.overallLimit?.message}
          >
            {(control) => (
              <AmountInput {...control} placeholder="No cap" {...form.register('overallLimit')} />
            )}
          </Field>
          <div className="sm:col-span-2">
            <Switch
              checked={form.watch('rolloverEnabled')}
              disabled={closed}
              onChange={(checked) =>
                form.setValue('rolloverEnabled', checked, { shouldDirty: true })
              }
              label="Carry what’s left into next period"
              description="A surplus raises next period’s allowance; a deficit lowers it. Both are facts, so both carry."
            />
          </div>
        </fieldset>
        {!closed && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-text-muted">
              Changing the plan never changes a transaction.
            </p>
            <Button type="submit" loading={save.isPending} disabled={!isDirty}>
              Save plan
            </Button>
          </div>
        )}
      </form>
    </CardSection>
  )
}

// ---------------------------------------------------------------------------

function CategoryList({
  usages,
  plan,
  summary,
  allCategories,
  currency,
  locale,
}: {
  readonly usages: readonly CategoryUsage[]
  readonly plan: BudgetPlan | null
  readonly summary: PeriodSummary | null
  readonly allCategories: readonly Category[]
  readonly currency: string
  readonly locale: string
}) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const shown = new Set(usages.map((usage) => usage.category.id))
  const unused = allCategories.filter((category) => !shown.has(category.id))
  const closed = plan === null || plan.closedAt !== null

  if (usages.length === 0 && unused.length === 0) {
    return <EmptyState title="No spending categories" body="Add categories in settings." />
  }

  return (
    <>
      {plan !== null && summary !== null && plan.expectedIncome.minor > 0n && (
        <OverallBar plan={plan} summary={summary} locale={locale} />
      )}
      <ul className="flex flex-col divide-y divide-border">
        {usages.map((usage) => (
          <li key={usage.category.id} className="flex flex-col gap-2 py-3">
            <div className="flex items-center gap-3">
              <CategoryIcon icon={usage.category.icon} color={usage.category.color} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-text">
                  <span className="truncate">{usage.category.name}</span>
                  {usage.category.treatment === 'fixed' && (
                    <span className="text-xs font-normal text-text-muted">Fixed</span>
                  )}
                </p>
                <p className="text-xs text-text-muted">
                  <Money value={usage.spentNet} locale={locale} /> spent
                  {usage.limit !== null && (
                    <>
                      {' '}
                      of <Money value={usage.limit} locale={locale} />
                    </>
                  )}
                  {usage.pace === 'ahead' &&
                    usage.status !== 'no_limit' &&
                    ' · spending faster than the month'}
                </p>
              </div>
              <BudgetStatusBadge status={usage.status} />
              {!closed && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing({ id: usage.category.id, name: usage.category.name })}
                >
                  {usage.limit === null ? 'Set limit' : 'Edit'}
                </Button>
              )}
            </div>
            {usage.status !== 'no_limit' && (
              <ProgressBar
                ratio={usage.usageRatio}
                marker={usage.elapsedRatio}
                tone={budgetStatusTone(usage.status)}
                label={`${usage.category.name}: ${Math.round(usage.usageRatio * 100)}% of limit`}
              />
            )}
          </li>
        ))}
        {!closed &&
          unused.map((category) => (
            <li key={category.id} className="flex items-center gap-3 py-2.5">
              <CategoryIcon icon={category.icon} color={category.color} size="sm" />
              <span className="flex-1 text-sm text-text-muted">{category.name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing({ id: category.id, name: category.name })}
              >
                Set limit
              </Button>
            </li>
          ))}
      </ul>
      {plan !== null && editing !== null && (
        <LimitSheet
          plan={plan}
          category={editing}
          current={usages.find((usage) => usage.category.id === editing.id)?.limit ?? null}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/** Variable spending against the whole period's allowance, with a tick for how far through it we are. */
function OverallBar({
  plan,
  summary,
  locale,
}: {
  readonly plan: BudgetPlan
  readonly summary: PeriodSummary
  readonly locale: string
}) {
  const today = useToday()
  if (today === null) return null
  const overall = calculateOverallBudgetUsage({
    plan,
    variableSpent: summary.variable,
    variableRefunded: summary.variableRefund,
    today,
    period: plan.period,
  })
  return (
    <div className="mb-3 flex flex-col gap-1.5 rounded-lg bg-bg p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-text">
          <Money value={overall.spentNet} locale={locale} className="font-semibold" />
          {overall.limit !== null && (
            <span className="text-text-muted">
              {' '}
              of <Money value={overall.limit} locale={locale} /> day-to-day allowance
            </span>
          )}
        </span>
        <BudgetStatusBadge status={overall.status} />
      </div>
      <ProgressBar
        ratio={overall.usageRatio}
        marker={overall.elapsedRatio}
        tone={budgetStatusTone(overall.status)}
        label="Day-to-day spending against the allowance"
      />
      <p className="text-xs text-text-muted">
        The tick marks how far through the period you are ({Math.round(overall.elapsedRatio * 100)}
        %).
      </p>
    </div>
  )
}

const limitSchema = z.object({ limit: amountField({ allowZero: true }) })

function LimitSheet({
  plan,
  category,
  current,
  currency,
  onClose,
}: {
  readonly plan: BudgetPlan
  readonly category: { readonly id: string; readonly name: string }
  readonly current: MoneyValue | null
  readonly currency: string
  readonly onClose: () => void
}) {
  const userId = useUserId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof limitSchema>>({
    resolver: zodResolver(limitSchema),
    defaultValues: { limit: current === null ? '' : toMajorString(current) },
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.budget() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() }),
    ])

  const save = useMutation({
    mutationFn: (values: z.infer<typeof limitSchema>) =>
      repositories.budgets.setCategoryLimit(
        userId,
        plan.id,
        category.id,
        toMoney(values.limit, currency),
      ),
    onSuccess: async () => {
      await refresh()
      toast.show({ tone: 'success', title: `${category.name} limit saved` })
      onClose()
    },
    onError: (error) => setServerError(toAppError(error)),
  })

  const remove = useMutation({
    mutationFn: () => repositories.budgets.removeCategoryLimit(plan.id, category.id),
    onSuccess: async () => {
      await refresh()
      toast.show({
        tone: 'info',
        title: `${category.name} limit removed`,
        body: 'Its spending is still tracked.',
      })
      onClose()
    },
    onError: (error) => setServerError(toAppError(error)),
  })

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={`${category.name} limit`}
      description={`For ${formatPeriodLabel(plan.period)}. Limits carry into next period automatically.`}
    >
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
        className="flex flex-col gap-4"
      >
        {serverError && <ErrorState error={serverError} title="Not saved" compact />}
        <Field label="Monthly limit" error={form.formState.errors.limit?.message}>
          {(control) => (
            <AmountInput {...control} scale="xl" data-autofocus {...form.register('limit')} />
          )}
        </Field>
        <div className="flex justify-between gap-2">
          {current !== null ? (
            <Button
              variant="ghost"
              className="text-negative"
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove limit
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" loading={save.isPending}>
            Save limit
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
