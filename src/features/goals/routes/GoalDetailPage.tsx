import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  Pencil,
  Trash,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card, CardSection, ROW_CARD_CLASS } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { ConfirmSheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { ProgressBar, StatusBadge } from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { useAccounts, usePreferences, useToday } from '@/data/queries'
import { repositories } from '@/data/repositories'
import {
  calculateGoalPlan,
  calculateGoalProgress,
  goalStatus,
  projectGoalCompletion,
} from '@/domain/goals/goals'
import { relativeDayLabel } from '@/domain/period/labels'
import { addDays, formatDate } from '@/domain/period/LocalDate'
import { directionOf } from '@/domain/transactions/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

import { EditGoalSheet, MoveMoneySheet } from '../components/GoalSheets'

const REASON_TEXT = {
  no_activity:
    'No money has moved into this goal in the last 90 days, so there is no pace to project from.',
  too_few_points: 'One contribution is not a pace yet. Add another and a projection appears here.',
  net_negative_rate:
    'More has come out than gone in recently, so at this pace the goal is not getting closer.',
} as const

export function GoalDetailPage() {
  const { id = '' } = useParams()
  const userId = useUserId()
  const today = useToday()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { currency, locale } = usePreferences()
  const accounts = useAccounts()
  const [sheet, setSheet] = useState<'in' | 'out' | 'edit' | 'delete' | null>(null)

  const goal = useQuery({
    queryKey: queryKeys.goal(id),
    queryFn: () => repositories.goals.getById(userId, id),
  })
  usePageTitle(goal.data?.name ?? 'Goal')
  const walletId = goal.data?.walletAccountId ?? null

  const entries = useQuery({
    queryKey: [
      ...queryKeys.goalActivity(id),
      'entries',
      today?.y,
      today?.m,
      today?.d,
      goal.data?.balance.minor.toString(),
    ],
    enabled: walletId !== null && today !== null,
    queryFn: () => {
      if (walletId === null || today === null) throw new Error('not ready')
      return repositories.transactions.accountEntries(userId, walletId, addDays(today, -89))
    },
  })

  const activity = useInfiniteQuery({
    queryKey: [...queryKeys.transactions({ goal: id }), walletId],
    enabled: walletId !== null,
    queryFn: ({ pageParam }) =>
      repositories.transactions.list(
        userId,
        { accountIds: walletId === null ? [] : [walletId] },
        pageParam,
        20,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.goals() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() }),
    ])

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      repositories.goals.update(id, { archivedAt: archived ? new Date().toISOString() : null }),
    onSuccess: async (_goal, archived) => {
      await refresh()
      toast.show({
        tone: 'info',
        title: archived ? 'Goal archived' : 'Goal restored',
        body: archived ? 'Its wallet and money are untouched.' : undefined,
      } as Parameters<typeof toast.show>[0])
    },
    onError: (error) => toast.show({ tone: 'error', title: toAppError(error).userMessage }),
  })

  const remove = useMutation({
    mutationFn: () => repositories.goals.remove(id),
    onSuccess: async () => {
      await refresh()
      toast.show({
        tone: 'info',
        title: 'Goal deleted',
        body: 'The wallet and its money stay in your accounts.',
      })
      await navigate('/goals', { replace: true })
    },
    onError: (error) => toast.show({ tone: 'error', title: toAppError(error).userMessage }),
  })

  if (goal.isPending || today === null) {
    return (
      <LoadingBlock label="Loading goal">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
        </div>
      </LoadingBlock>
    )
  }
  if (goal.isError)
    return <ErrorState error={toAppError(goal.error)} onRetry={() => void goal.refetch()} />
  if (goal.data === null) {
    // "Not found" and "not yours" are the same page (SECURITY.md §8.3).
    return (
      <div className="flex flex-col items-start gap-3 py-12">
        <h1 className="text-2xl font-semibold text-text">This goal is not available</h1>
        <p className="text-text-muted">It may have been deleted.</p>
        <Link to="/goals" className="font-medium text-brand hover:underline">
          Back to goals
        </Link>
      </div>
    )
  }

  const data = goal.data
  const progress = calculateGoalProgress(data)
  const projection = projectGoalCompletion({ ...data, entries: entries.data ?? [], today })
  const plan = calculateGoalPlan({
    ...data,
    today,
    ratePerDay: projection.status === 'projected' ? projection.ratePerDay : null,
  })
  const status = goalStatus(data)
  const rows = activity.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/goals"
        className="inline-flex items-center gap-1 text-sm font-medium text-text-muted hover:text-text"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Goals
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">{data.name}</h1>
          <p className="text-sm text-text-muted">
            Backed by{' '}
            {accounts.data?.find((account) => account.id === data.walletAccountId)?.name ??
              'its wallet'}
            {data.targetDate !== null && <> · by {formatDate(data.targetDate, locale)}</>}
          </p>
        </div>
        {status === 'achieved' && (
          <StatusBadge tone="positive">
            Reached{data.reachedOn ? ` on ${formatDate(data.reachedOn, locale)}` : ''}
          </StatusBadge>
        )}
        {status === 'archived' && <StatusBadge tone="neutral">Archived</StatusBadge>}
      </header>

      <Card className="flex flex-col gap-4">
        <p className="text-text-muted">
          <Money
            value={data.balance}
            locale={locale}
            className="text-4xl font-semibold tracking-tight text-text"
          />
          <span className="ml-2">
            of <Money value={data.target} locale={locale} />
          </span>
        </p>
        <ProgressBar
          ratio={progress.displayRatio}
          tone={progress.isAchieved ? 'positive' : 'info'}
          label={`${Math.round(progress.displayRatio * 100)}% of the target saved`}
          className="h-3"
        />
        <p className="text-sm text-text-muted">
          {progress.isAchieved ? (
            'Reached. Spending the money on what it was for keeps the goal reached.'
          ) : (
            <>
              <Money value={progress.remaining} locale={locale} className="font-medium text-text" />{' '}
              to go · {Math.round(progress.progressRatio * 100)}% there
            </>
          )}
        </p>
        {status !== 'archived' && (
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<ArrowDownLeft aria-hidden="true" className="size-4" />}
              onClick={() => setSheet('in')}
            >
              Add money
            </Button>
            <Button
              variant="secondary"
              icon={<ArrowUpRight aria-hidden="true" className="size-4" />}
              onClick={() => setSheet('out')}
            >
              Withdraw
            </Button>
          </div>
        )}
      </Card>

      {!progress.isAchieved && (
        <CardSection title="Plan" titleId="goal-plan">
          <div className="flex flex-col gap-3 text-sm">
            {plan.status === 'no_target_date' && (
              <p className="text-text-muted">
                Add a target date and we will tell you what to set aside each month.
              </p>
            )}
            {plan.status === 'overdue' && (
              <p className="text-caution">
                The target date has passed. Choose a new date to get a fresh plan.
              </p>
            )}
            {(plan.status === 'on_track' || plan.status === 'behind') &&
              plan.requiredPerMonth !== null && (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-text-muted">Each month</dt>
                    <dd>
                      <Money
                        value={plan.requiredPerMonth}
                        locale={locale}
                        className="font-semibold"
                      />
                    </dd>
                  </div>
                  {plan.requiredPerWeek !== null && (
                    <div>
                      <dt className="text-xs text-text-muted">Each week</dt>
                      <dd>
                        <Money
                          value={plan.requiredPerWeek}
                          locale={locale}
                          className="font-semibold"
                        />
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-text-muted">Days left</dt>
                    <dd className="font-semibold tabular">{plan.daysRemaining}</dd>
                  </div>
                </dl>
              )}
            {plan.status === 'behind' && (
              <StatusBadge tone="caution">Behind at your recent pace</StatusBadge>
            )}
            <div className="rounded-lg bg-bg p-3">
              <p className="text-xs font-medium text-text-muted">At your recent pace</p>
              {projection.status === 'projected' ? (
                <p className="mt-0.5 text-text">
                  You would get there around{' '}
                  <span className="font-semibold">{formatDate(projection.date, locale)}</span>,
                  saving about <Money value={projection.ratePerDay} locale={locale} /> a day{' '}
                  <span className="text-text-muted">({projection.confidence} confidence)</span>.
                </p>
              ) : projection.status === 'achieved' ? (
                <p className="mt-0.5 text-text">Already there.</p>
              ) : (
                <p className="mt-0.5 text-text-muted">{REASON_TEXT[projection.reason]}</p>
              )}
            </div>
          </div>
        </CardSection>
      )}

      <CardSection title="Activity" titleId="goal-activity" bare>
        {activity.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : activity.isError ? (
          <ErrorState
            error={toAppError(activity.error)}
            onRetry={() => void activity.refetch()}
            compact
          />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="No activity yet"
              body="Money you move into the wallet shows up here."
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  to={`/transactions/${row.id}/edit`}
                  state={{ background: location }}
                  className={ROW_CARD_CLASS}
                >
                  <TransactionRow
                    title={
                      row.description ||
                      (directionOf(row, walletId ?? undefined) === 'in' ? 'Added' : 'Taken out')
                    }
                    subtitle={relativeDayLabel(row.occurredOn, today, locale)}
                    amount={row.amount}
                    direction={directionOf(row, walletId ?? undefined)}
                    isTransfer={row.kind === 'transfer'}
                    locale={locale}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {activity.hasNextPage && (
          <Button
            variant="secondary"
            className="mt-3"
            loading={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </CardSection>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={<Pencil aria-hidden="true" className="size-4" />}
          onClick={() => setSheet('edit')}
        >
          Edit goal
        </Button>
        <Button
          variant="secondary"
          loading={archive.isPending}
          icon={
            status === 'archived' ? (
              <ArchiveRestore aria-hidden="true" className="size-4" />
            ) : (
              <Archive aria-hidden="true" className="size-4" />
            )
          }
          onClick={() => archive.mutate(status !== 'archived')}
        >
          {status === 'archived' ? 'Restore' : 'Archive'}
        </Button>
        <Button
          variant="ghost"
          className="text-negative"
          icon={<Trash aria-hidden="true" className="size-4" />}
          onClick={() => setSheet('delete')}
        >
          Delete
        </Button>
      </div>

      {(sheet === 'in' || sheet === 'out') && (
        <MoveMoneySheet
          goal={data}
          direction={sheet}
          accounts={accounts.data ?? []}
          currency={currency}
          today={today}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'edit' && (
        <EditGoalSheet goal={data} currency={currency} onClose={() => setSheet(null)} />
      )}
      <ConfirmSheet
        open={sheet === 'delete'}
        onOpenChange={(open) => setSheet(open ? 'delete' : null)}
        title={`Delete ${data.name}?`}
        description="The goal goes; its wallet and every rupee in it stay in your accounts. Its wallet can’t back a new goal — archive instead if you might come back to it."
        confirmLabel="Delete goal"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
