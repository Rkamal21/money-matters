import { useInfiniteQuery } from '@tanstack/react-query'
import { ListFilter, Plus, Search, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card, ROW_CARD_CLASS } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { Badge } from '@/components/ui/Status'
import { TransactionRow } from '@/components/ui/TransactionRow'
import {
  useAccounts,
  useCategories,
  useCurrentPlan,
  usePreferences,
  useToday,
} from '@/data/queries'
import { repositories } from '@/data/repositories'
import { lastDay } from '@/domain/period/BudgetPeriod'
import { relativeDayLabel } from '@/domain/period/labels'
import { toISO } from '@/domain/period/LocalDate'
import { directionOf, type Transaction, type TransactionKind } from '@/domain/transactions/types'
import { useDebounce } from '@/hooks/useDebounce'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

import { useTransactionFilters } from '../hooks/useTransactionFilters'

type KindChoice = 'all' | TransactionKind

const KIND_CHOICES: readonly { readonly value: KindChoice; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Spent' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Moved' },
]

const KIND_LABEL: Readonly<Record<TransactionKind, string>> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  refund: 'Refund',
}

export function TransactionsPage() {
  usePageTitle('Activity')
  const location = useLocation()
  const userId = useUserId()
  const today = useToday()
  const { locale } = usePreferences()
  const accounts = useAccounts()
  const categories = useCategories()
  const plan = useCurrentPlan()
  const { state, filter, update, clear, activeCount } = useTransactionFilters()
  const [search, setSearch] = useState(state.q)
  const debouncedSearch = useDebounce(search, 300)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    if (debouncedSearch !== state.q) update({ q: debouncedSearch }, { replace: true })
  }, [debouncedSearch, state.q, update])

  const list = useInfiniteQuery({
    queryKey: queryKeys.transactions(filter),
    queryFn: ({ pageParam }) => repositories.transactions.list(userId, filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  )
  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  )

  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const groups = useMemo(() => {
    const out: { key: string; items: Transaction[] }[] = []
    for (const row of rows) {
      const key = toISO(row.occurredOn)
      const last = out[out.length - 1]
      if (last !== undefined && last.key === key) last.items.push(row)
      else out.push({ key, items: [row] })
    }
    return out
  }, [rows])

  const kindChoice: KindChoice = state.kinds.length === 1 ? (state.kinds[0] ?? 'all') : 'all'
  const filtered = activeCount > 0 || state.q !== ''

  const describe = (row: Transaction) => {
    const category = row.categoryId === null ? null : categoryById.get(row.categoryId)
    const account = accountById.get(row.accountId)?.name ?? 'Account'
    const title = row.merchantLabel || row.description || category?.name || KIND_LABEL[row.kind]
    const parts: string[] = []
    if (row.kind === 'transfer') {
      parts.push(
        `${account} → ${row.counterAccountId === null ? '' : (accountById.get(row.counterAccountId)?.name ?? 'Account')}`,
      )
    } else {
      parts.push(account)
      if (row.isSplit)
        parts.push(
          row.splits
            .map((split) => categoryById.get(split.categoryId)?.name ?? '')
            .filter(Boolean)
            .join(', '),
        )
      else if (category && title !== category.name) parts.push(category.name)
      if (row.kind === 'refund') parts.push('Refund')
    }
    return { title, subtitle: parts.join(' · '), category }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Activity</h1>
        <Link
          to="/transactions/new"
          state={{ background: location }}
          className="hidden h-11 items-center gap-2 rounded-lg bg-brand-strong px-4 text-sm font-semibold text-on-brand hover:bg-brand-strong/90 sm:inline-flex"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add
        </Link>
      </header>

      <Card className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          />
          <label htmlFor="transaction-search" className="sr-only">
            Search transactions
          </label>
          <Input
            id="transaction-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search merchant or note"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            legend="Show"
            className="min-w-0 flex-1"
            value={kindChoice}
            options={KIND_CHOICES}
            onChange={(value) => update({ kinds: value === 'all' ? [] : [value] })}
          />
          <Button
            variant="secondary"
            icon={<ListFilter aria-hidden="true" className="size-4" />}
            onClick={() => setFiltersOpen(true)}
          >
            Filters
            {activeCount > 0 && <Badge className="bg-brand/15 text-brand">{activeCount}</Badge>}
          </Button>
          {filtered && (
            <Button
              variant="ghost"
              icon={<X aria-hidden="true" className="size-4" />}
              onClick={() => {
                setSearch('')
                clear()
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </Card>

      <section aria-label="Transactions" aria-busy={list.isFetching}>
        {list.isPending ? (
          <LoadingBlock label="Loading transactions">
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          </LoadingBlock>
        ) : list.isError ? (
          <ErrorState error={toAppError(list.error)} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No matches"
              body="Nothing fits these filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    clear()
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No transactions yet"
              body="Log what you spend and earn. Transfers between your accounts go here too."
              action={
                <Link
                  to="/transactions/new"
                  state={{ background: location }}
                  className="font-medium text-brand hover:underline"
                >
                  Add your first transaction
                </Link>
              }
            />
          )
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <Fragment key={group.key}>
                <div className="flex flex-col gap-2">
                  <h2 className="px-1 text-sm font-semibold text-text-muted">
                    {today === null
                      ? group.key
                      : relativeDayLabel(group.items[0]?.occurredOn ?? today, today, locale)}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {group.items.map((row) => {
                      const view = describe(row)
                      return (
                        <li key={row.id}>
                          <Link
                            to={`/transactions/${row.id}/edit`}
                            state={{ background: location }}
                            className={ROW_CARD_CLASS}
                          >
                            <TransactionRow
                              title={view.title}
                              subtitle={view.subtitle}
                              amount={row.amount}
                              direction={directionOf(row)}
                              icon={view.category?.icon ?? null}
                              color={view.category?.color ?? null}
                              isTransfer={row.kind === 'transfer'}
                              isSplit={row.isSplit}
                              locale={locale}
                            />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </Fragment>
            ))}
            {list.hasNextPage && (
              <Button
                variant="secondary"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load more
              </Button>
            )}
          </div>
        )}
      </section>

      <Sheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filters"
        footer={
          <div className="flex justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => update({ accountIds: [], categoryIds: [], from: '', to: '' })}
            >
              Reset
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            {plan.data && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  update({
                    from: toISO(plan.data.period.start),
                    to: toISO(lastDay(plan.data.period)),
                  })
                }
              >
                This period
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => update({ kinds: ['refund'] })}>
              Refunds only
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={state.from}
                  onChange={(event) => update({ from: event.target.value })}
                />
              )}
            </Field>
            <Field label="To">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={state.to}
                  onChange={(event) => update({ to: event.target.value })}
                />
              )}
            </Field>
          </div>
          <CheckList
            legend="Accounts"
            options={(accounts.data ?? []).map((account) => ({
              id: account.id,
              label: account.name,
            }))}
            selected={state.accountIds}
            onChange={(ids) => update({ accountIds: ids })}
          />
          <CheckList
            legend="Categories"
            options={(categories.data ?? []).map((category) => ({
              id: category.id,
              label: category.name,
            }))}
            selected={state.categoryIds}
            onChange={(ids) => update({ categoryIds: ids })}
          />
        </div>
      </Sheet>
    </div>
  )
}

function CheckList({
  legend,
  options,
  selected,
  onChange,
}: {
  readonly legend: string
  readonly options: readonly { readonly id: string; readonly label: string }[]
  readonly selected: readonly string[]
  readonly onChange: (ids: string[]) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-text">{legend}</legend>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {options.map((option) => (
          <li key={option.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-text hover:bg-surface-2">
              <input
                type="checkbox"
                className="size-4"
                checked={selected.includes(option.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.id]
                      : selected.filter((id) => id !== option.id),
                  )
                }
              />
              {option.label}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}
