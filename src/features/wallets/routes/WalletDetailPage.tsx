import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronLeft, ListFilter, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useLocation, useParams } from 'react-router'

import { ACCOUNT_TYPE_LABEL, AccountIcon } from '@/components/ui/AccountIcon'
import { Button } from '@/components/ui/Button'
import { Card, CardSection, ROW_CARD_CLASS } from '@/components/ui/Card'
import { HeroShapes } from '@/components/ui/HeroShapes'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { ProgressBar } from '@/components/ui/Status'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { useAccounts, useCategories, useGoals, usePreferences, useToday } from '@/data/queries'
import { repositories } from '@/data/repositories'
import { calculateGoalProgress } from '@/domain/goals/goals'
import { relativeDayLabel } from '@/domain/period/labels'
import { amountOwed } from '@/domain/transactions/accounts'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

import { describeTransaction } from '../describe'

/**
 * One wallet: its balance on the dark card, the goal it is for (if any), and
 * every ledger line that touched it. The goal is shown, not merged — a goal
 * is the purpose of a wallet, and has its own page (ADR-0026).
 */
export function WalletDetailPage() {
  const { id = '' } = useParams()
  const userId = useUserId()
  const today = useToday()
  const location = useLocation()
  const { locale } = usePreferences()
  const accounts = useAccounts()
  const goals = useGoals()
  const categories = useCategories()

  const account = accounts.data?.find((candidate) => candidate.id === id)
  usePageTitle(account?.name ?? 'Wallet')
  const goal =
    goals.data?.find((g) => g.walletAccountId === id && g.archivedAt === null) ??
    goals.data?.find((g) => g.walletAccountId === id)

  const lookups = useMemo(
    () => ({
      categories: new Map((categories.data ?? []).map((c) => [c.id, c] as const)),
      accounts: new Map((accounts.data ?? []).map((a) => [a.id, a] as const)),
    }),
    [categories.data, accounts.data],
  )

  const activity = useInfiniteQuery({
    queryKey: queryKeys.transactions({ wallet: id }),
    enabled: account !== undefined,
    queryFn: ({ pageParam }) =>
      repositories.transactions.list(userId, { accountIds: [id] }, pageParam, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })

  if (accounts.isPending) {
    return (
      <LoadingBlock label="Loading wallet">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full rounded-3xl" />
        </div>
      </LoadingBlock>
    )
  }
  if (accounts.isError) {
    return <ErrorState error={toAppError(accounts.error)} onRetry={() => void accounts.refetch()} />
  }
  if (account === undefined) {
    // "Not found" and "not yours" are the same page (SECURITY.md §8.3).
    return (
      <div className="flex flex-col items-start gap-3 py-12">
        <h1 className="text-2xl font-semibold text-text">This wallet is not available</h1>
        <p className="text-text-muted">It may have been deleted.</p>
        <Link to="/wallets" className="font-medium text-brand hover:underline">
          Back to wallets
        </Link>
      </div>
    )
  }

  const credit = account.type === 'credit_card'
  const progress = goal === undefined ? null : calculateGoalProgress(goal)
  const rows = activity.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/wallets"
        className="inline-flex items-center gap-1 self-start text-sm font-medium text-text-muted hover:text-text"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Wallets
      </Link>

      <header className="flex items-center gap-3">
        <AccountIcon type={account.type} identityKey={account.id} />
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-text">
            {account.name}
          </h1>
          <p className="text-sm text-text-muted">
            {ACCOUNT_TYPE_LABEL[account.type]}
            {account.isArchived ? ' · Archived' : ''}
          </p>
        </div>
      </header>

      <section
        aria-labelledby="wallet-balance"
        className="theme-inverse relative overflow-hidden rounded-3xl p-5 shadow-overlay sm:p-6"
      >
        <HeroShapes />
        <div className="relative flex flex-col gap-4">
          <div>
            <h2 id="wallet-balance" className="pr-24 text-sm font-medium text-text-muted">
              {credit ? 'Owed on this card' : 'Balance'}
            </h2>
            <Money
              value={credit ? amountOwed(account.balance) : account.balance}
              locale={locale}
              tone={!credit && account.balance.minor < 0n ? 'negative' : 'default'}
              className="mt-1 block text-4xl font-semibold tracking-tight"
            />
          </div>

          {goal !== undefined && progress !== null && (
            <div className="flex flex-col gap-2 rounded-xl bg-bg p-3">
              <p className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  For <span className="font-semibold">{goal.name}</span>
                </span>
                <span className="shrink-0 text-text-muted">
                  {progress.isAchieved ? 'Reached' : `${Math.round(progress.displayRatio * 100)}%`}
                </span>
              </p>
              <ProgressBar
                ratio={progress.displayRatio}
                tone={progress.isAchieved ? 'positive' : 'info'}
                label={`${goal.name}: ${Math.round(progress.displayRatio * 100)}% saved`}
                className="h-1.5"
              />
              <p className="flex items-center justify-between gap-2 text-xs text-text-muted">
                <span>
                  <Money value={goal.balance} locale={locale} /> of{' '}
                  <Money value={goal.target} locale={locale} />
                </span>
                <Link
                  to={`/goals/${goal.id}`}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Open goal
                </Link>
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Link
              to="/transactions/new"
              state={{ background: location }}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-strong px-4 text-sm font-semibold text-on-brand hover:bg-brand-strong/90"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add transaction
            </Link>
            <Link
              to={`/transactions?account=${account.id}`}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-2"
            >
              <ListFilter aria-hidden="true" className="size-4" />
              Filter in Activity
            </Link>
          </div>
        </div>
      </section>

      <CardSection title="Activity" titleId="wallet-activity" bare>
        {activity.isPending ? (
          <LoadingBlock label="Loading activity">
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-[4.375rem] w-full rounded-2xl" />
              ))}
            </div>
          </LoadingBlock>
        ) : activity.isError ? (
          <ErrorState error={toAppError(activity.error)} onRetry={() => void activity.refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing has moved yet"
              body="Money spent from, paid into or moved through this wallet shows up here."
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const view = describeTransaction(row, lookups, account.id)
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
    </div>
  )
}
