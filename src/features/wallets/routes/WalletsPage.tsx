import { useQuery } from '@tanstack/react-query'
import { CirclePlus, ListFilter, Target } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useLocation } from 'react-router'

import { ACCOUNT_TYPE_LABEL, AccountIcon } from '@/components/ui/AccountIcon'
import { Card, CardSection, ROW_CARD_CLASS } from '@/components/ui/Card'
import { identityFill, identityOf, identityTile } from '@/components/ui/identity'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { ProgressBar } from '@/components/ui/Status'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { useAccounts, useCategories, useGoals, usePreferences, useToday } from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { GoalWithProgress } from '@/domain/goals/Goal'
import { calculateGoalProgress } from '@/domain/goals/goals'
import { relativeDayLabel } from '@/domain/period/labels'
import { amountOwed } from '@/domain/transactions/accounts'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

import { describeTransaction } from '../describe'

/**
 * The reference design's Wallet screen: a row of wallet cards you can swipe
 * through, the latest transactions, and savings.
 *
 * A wallet here is an account — a container of money whose balance comes
 * from the ledger (ADR-0026). The card borrows the reference's shape — a
 * balance on top, a dark strip underneath — but not its payment-card details:
 * there is no card number, holder name or expiry, because a wallet is not a
 * card and none of those are stored.
 */

type AccountRow = NonNullable<ReturnType<typeof useAccounts>['data']>[number]

export function WalletsPage() {
  usePageTitle('Wallets')
  const userId = useUserId()
  const location = useLocation()
  const today = useToday()
  const { locale } = usePreferences()
  const accounts = useAccounts()
  const goals = useGoals()
  const categories = useCategories()

  const open = useMemo(
    () => (accounts.data ?? []).filter((account) => !account.isArchived),
    [accounts.data],
  )
  const activeGoals = useMemo(
    () => (goals.data ?? []).filter((goal) => goal.archivedAt === null),
    [goals.data],
  )
  const goalByWallet = useMemo(
    () => new Map(activeGoals.map((goal) => [goal.walletAccountId, goal] as const)),
    [activeGoals],
  )
  const lookups = useMemo(
    () => ({
      categories: new Map((categories.data ?? []).map((c) => [c.id, c] as const)),
      accounts: new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    }),
    [categories.data, accounts.data],
  )

  const recent = useQuery({
    queryKey: queryKeys.transactions({ view: 'wallets-recent' }),
    queryFn: () => repositories.transactions.list(userId, {}, null, 5),
  })
  const rows = recent.data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Wallets</h1>
          <p className="text-sm text-text-muted">
            Where your money sits. Open one to see what moved.
          </p>
        </div>
        <Link
          to="/settings/accounts"
          className="inline-flex h-11 shrink-0 items-center rounded-xl border border-border-strong/50 bg-surface px-4 text-sm font-medium text-text hover:bg-surface-2"
        >
          Manage
        </Link>
      </header>

      <section aria-labelledby="wallets-list">
        <h2 id="wallets-list" className="sr-only">
          Your wallets
        </h2>
        {accounts.isPending ? (
          <LoadingBlock label="Loading wallets">
            <div className="flex gap-3 overflow-hidden">
              <Skeleton className="h-44 w-72 shrink-0 rounded-2xl" />
              <Skeleton className="h-44 w-72 shrink-0 rounded-2xl" />
            </div>
          </LoadingBlock>
        ) : accounts.isError ? (
          <ErrorState error={toAppError(accounts.error)} onRetry={() => void accounts.refetch()} />
        ) : open.length === 0 ? (
          <Card>
            <EmptyState
              title="No wallets yet"
              body="Add a bank account, cash, a card or a savings wallet and it shows up here."
              action={
                <Link to="/settings/accounts" className="font-medium text-brand hover:underline">
                  Add an account
                </Link>
              }
            />
          </Card>
        ) : (
          // Swipe through on a phone (snap to each card); a grid from `sm` up.
          // `relative` makes the scroller the containing block for the
          // screen-reader-only spoken amounts (absolutely positioned), so they
          // stay clipped inside it instead of widening the whole page.
          <ul className="relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
            <li className="flex shrink-0 snap-start">
              <Link
                to="/settings/accounts"
                className="flex min-h-44 w-16 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-strong/60 text-text-muted transition-colors duration-150 hover:border-text hover:text-text sm:w-full"
              >
                <CirclePlus aria-hidden="true" className="size-6" />
                <span className="sr-only sm:not-sr-only sm:text-sm sm:font-medium">
                  Add a wallet
                </span>
              </Link>
            </li>
            {open.map((account) => (
              <li
                key={account.id}
                className="w-72 max-w-[85vw] shrink-0 snap-start sm:w-auto sm:max-w-none"
              >
                <WalletCard account={account} goal={goalByWallet.get(account.id)} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <CardSection
        title="Transactions"
        titleId="wallets-transactions"
        bare
        action={
          <Link
            to="/transactions"
            aria-label="All activity, with filters"
            title="All activity"
            className="inline-flex size-11 items-center justify-center rounded-xl text-text-muted hover:bg-surface hover:text-text"
          >
            <ListFilter aria-hidden="true" className="size-5" />
          </Link>
        }
      >
        {recent.isPending ? (
          <LoadingBlock label="Loading transactions">
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-[4.375rem] w-full rounded-2xl" />
              ))}
            </div>
          </LoadingBlock>
        ) : recent.isError ? (
          <ErrorState error={toAppError(recent.error)} onRetry={() => void recent.refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing moved yet"
              body="Money in, out and between your wallets shows up here."
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const view = describeTransaction(row, lookups)
              return (
                <li key={row.id}>
                  <Link
                    to={`/transactions/${row.id}/edit`}
                    state={{ background: location }}
                    className={ROW_CARD_CLASS}
                  >
                    <TransactionRow
                      title={view.title}
                      subtitle={
                        today === null
                          ? view.subtitle
                          : [relativeDayLabel(row.occurredOn, today, locale), view.subtitle]
                              .filter(Boolean)
                              .join(' · ')
                      }
                      amount={row.amount}
                      direction={view.direction}
                      icon={view.icon}
                      color={view.color}
                      isTransfer={row.kind === 'transfer'}
                      isSplit={row.isSplit}
                      locale={locale}
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardSection>

      <CardSection
        title="Savings"
        titleId="wallets-savings"
        bare
        action={
          <Link to="/goals" className="text-sm font-medium text-brand hover:underline">
            See all
          </Link>
        }
      >
        {goals.isPending ? (
          <LoadingBlock label="Loading savings">
            <Skeleton className="h-[4.375rem] w-full rounded-2xl" />
          </LoadingBlock>
        ) : goals.isError ? (
          <ErrorState error={toAppError(goals.error)} onRetry={() => void goals.refetch()} />
        ) : activeGoals.length === 0 ? (
          <Card>
            <EmptyState
              title="No savings goals yet"
              body="Give a wallet a purpose — a laptop, a trip, an emergency fund."
              action={
                <Link to="/goals?new=1" className="font-medium text-brand hover:underline">
                  Create a goal
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeGoals.map((goal) => (
              <li key={goal.id}>
                <SavingsRow goal={goal} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </CardSection>
    </div>
  )
}

function WalletCard({
  account,
  goal,
  locale,
}: {
  readonly account: AccountRow
  readonly goal: GoalWithProgress | undefined
  readonly locale: string
}) {
  const credit = account.type === 'credit_card'
  return (
    <Link
      to={`/wallets/${account.id}`}
      className="flex h-full min-h-44 flex-col overflow-hidden rounded-2xl border border-card-border bg-surface shadow-card transition-shadow duration-150 hover:shadow-overlay"
    >
      <span className="flex flex-1 flex-col gap-1 p-4">
        <span className="flex items-start justify-between gap-2">
          <span className="text-xs text-text-muted">{credit ? 'Owed' : 'Balance'}</span>
          <AccountIcon type={account.type} identityKey={account.id} size="sm" />
        </span>
        <Money
          value={credit ? amountOwed(account.balance) : account.balance}
          locale={locale}
          tone={!credit && account.balance.minor < 0n ? 'negative' : 'default'}
          className="text-2xl font-semibold tracking-tight"
        />
        {goal !== undefined && (
          <span className="text-xs text-text-muted">
            For <span className="font-medium text-text">{goal.name}</span>
          </span>
        )}
      </span>
      {/* The reference card's dark strip — the wallet's name and kind, not card details. */}
      <span className="theme-inverse flex items-end justify-between gap-3 px-4 py-2.5">
        <span className="min-w-0">
          <span className="block text-[0.6875rem] text-text-muted">Name</span>
          <span className="block truncate text-sm font-semibold">{account.name}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[0.6875rem] text-text-muted">Type</span>
          <span className="block text-sm font-medium">{ACCOUNT_TYPE_LABEL[account.type]}</span>
        </span>
      </span>
    </Link>
  )
}

function SavingsRow({
  goal,
  locale,
}: {
  readonly goal: GoalWithProgress
  readonly locale: string
}) {
  const progress = calculateGoalProgress(goal)
  const identity = identityOf(goal.walletAccountId)
  const percent = Math.round(progress.displayRatio * 100)
  return (
    <Link
      to={`/goals/${goal.id}`}
      className={cn(ROW_CARD_CLASS, 'flex min-h-[4.375rem] items-center gap-3 py-3')}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-xl',
          identityTile(identity),
        )}
      >
        <Target className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="truncate text-sm font-semibold text-text">{goal.name}</span>
        <ProgressBar
          ratio={progress.displayRatio}
          label={`${goal.name}: ${percent}% saved`}
          className="h-1.5"
          {...(progress.isAchieved
            ? { tone: 'positive' as const }
            : { fillClassName: identityFill(identity) })}
        />
      </span>
      <span className="shrink-0 text-right">
        <Money value={goal.balance} locale={locale} className="block text-sm font-semibold" />
        <span className="text-xs text-text-muted">
          {progress.isAchieved ? 'Reached' : `${percent}%`}
        </span>
      </span>
    </Link>
  )
}
