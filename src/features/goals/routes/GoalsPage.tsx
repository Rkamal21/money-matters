import { Plus, Target } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card, CARD_CLASS } from '@/components/ui/Card'
import { identityFill, identityOf, identityTile } from '@/components/ui/identity'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { ProgressBar, StatusBadge } from '@/components/ui/Status'
import { useAccounts, useGoals, usePreferences, useToday } from '@/data/queries'
import type { GoalWithProgress } from '@/domain/goals/Goal'
import { calculateGoalPlan, calculateGoalProgress, goalStatus } from '@/domain/goals/goals'
import { formatDate, type LocalDate } from '@/domain/period/LocalDate'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'

import { CreateGoalSheet } from '../components/GoalSheets'

export function GoalsPage() {
  usePageTitle('Goals')
  const goals = useGoals()
  const accounts = useAccounts()
  const today = useToday()
  const { currency, locale } = usePreferences()
  const [params, setParams] = useSearchParams()
  const creating = params.get('new') === '1'

  const all = goals.data ?? []
  const active = all.filter((goal) => goal.archivedAt === null)
  const archived = all.filter((goal) => goal.archivedAt !== null)
  const backing = new Set(all.map((goal) => goal.walletAccountId))
  const freeWallets = (accounts.data ?? []).filter(
    (account) => account.type === 'wallet' && !account.isArchived && !backing.has(account.id),
  )

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Goals</h1>
          <p className="text-sm text-text-muted">
            Money with a purpose. Each goal is backed by its own wallet.
          </p>
        </div>
        <Button
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => setParams({ new: '1' })}
        >
          New goal
        </Button>
      </header>

      {goals.isPending || today === null ? (
        <LoadingBlock label="Loading goals">
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        </LoadingBlock>
      ) : goals.isError ? (
        <ErrorState error={toAppError(goals.error)} onRetry={() => void goals.refetch()} />
      ) : active.length === 0 && archived.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Target className="size-6" />}
            title="No goals yet"
            body="An emergency fund, a laptop, a trip. Give money a purpose and watch the wallet fill."
            action={<Button onClick={() => setParams({ new: '1' })}>Create your first goal</Button>}
          />
        </Card>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {active.map((goal) => (
              <li key={goal.id}>
                <GoalCard goal={goal} today={today} locale={locale} />
              </li>
            ))}
          </ul>
          {archived.length > 0 && (
            <details className="rounded-xl border border-border bg-surface">
              <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-medium text-text">
                Archived goals ({archived.length})
              </summary>
              <ul className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                {archived.map((goal) => (
                  <li key={goal.id}>
                    <GoalCard goal={goal} today={today} locale={locale} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {today !== null && (
        <CreateGoalSheet
          open={creating}
          onClose={() => setParams({})}
          wallets={freeWallets}
          currency={currency}
          today={today}
        />
      )}
    </div>
  )
}

function GoalCard({
  goal,
  today,
  locale,
}: {
  readonly goal: GoalWithProgress
  readonly today: LocalDate
  readonly locale: string
}) {
  const progress = calculateGoalProgress(goal)
  const plan = calculateGoalPlan({ ...goal, today })
  const status = goalStatus(goal)
  const identity = identityOf(goal.walletAccountId)
  const percent = Math.round(progress.displayRatio * 100)
  return (
    // The reference's Savings card, kept white: its colour lives in the
    // corner shape and the progress fill, never the whole card.
    <Link
      to={`/goals/${goal.id}`}
      className={cn(
        CARD_CLASS,
        'relative flex h-full flex-col gap-3 overflow-hidden transition-colors duration-150 hover:bg-surface-2',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -top-7 -right-7 inline-flex size-24 items-end justify-start rounded-full p-6',
          identityTile(identity),
        )}
      >
        <Target className="size-6" />
      </span>
      <div className="relative flex flex-col items-start gap-1.5 pr-16">
        <p className="text-base font-semibold text-text">{goal.name}</p>
        {status === 'achieved' && <StatusBadge tone="positive">Reached</StatusBadge>}
        {status === 'archived' && <StatusBadge tone="neutral">Archived</StatusBadge>}
        {status === 'active' && plan.status === 'overdue' && (
          <StatusBadge tone="caution">Past date</StatusBadge>
        )}
      </div>
      <div className="relative flex flex-col gap-1.5">
        <p className="text-xs text-text-muted">Balance</p>
        <ProgressBar
          ratio={progress.displayRatio}
          label={`${goal.name}: ${percent}% saved`}
          className="h-1.5"
          {...(progress.isAchieved
            ? { tone: 'positive' as const }
            : { fillClassName: identityFill(identity) })}
        />
        <p className="flex items-baseline justify-between gap-2 text-sm text-text-muted">
          <span>
            <Money value={goal.balance} locale={locale} className="font-semibold text-text" />{' '}
            <span className="text-xs">
              of <Money value={goal.target} locale={locale} />
            </span>
          </span>
          <span className="shrink-0 text-xs">
            <span className="tabular">{percent}%</span>
            {!progress.isAchieved && plan.daysRemaining !== null && plan.daysRemaining > 0 && (
              <>
                {' · '}
                {plan.daysRemaining} {plan.daysRemaining === 1 ? 'day' : 'days'} left
              </>
            )}
          </span>
        </p>
      </div>
      <p className="relative text-xs text-text-muted">
        {progress.isAchieved ? (
          'Target reached — spending it on its purpose keeps it reached.'
        ) : plan.requiredPerMonth !== null && goal.targetDate !== null ? (
          <>
            About <Money value={plan.requiredPerMonth} locale={locale} /> a month to reach it by{' '}
            {formatDate(goal.targetDate, locale)}
          </>
        ) : (
          <>
            <Money value={progress.remaining} locale={locale} /> to go
          </>
        )}
      </p>
      <span className="relative mt-auto text-sm font-medium text-brand">See detail</span>
    </Link>
  )
}
