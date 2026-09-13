import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronRight,
  Landmark,
  Percent,
  PiggyBank,
} from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { Link, useLocation } from 'react-router'

import { CategoryDonut } from '@/components/charts/CategoryDonut'
import { ACCOUNT_TYPE_LABEL, AccountIcon } from '@/components/ui/AccountIcon'
import { Card, CARD_CLASS, ROW_CARD_CLASS } from '@/components/ui/Card'
import { identityFill, identityOf } from '@/components/ui/identity'
import { Money } from '@/components/ui/Money'
import { EmptyState } from '@/components/ui/States'
import { BudgetStatusBadge, budgetStatusTone, ProgressBar } from '@/components/ui/Status'
import { TransactionRow } from '@/components/ui/TransactionRow'
import { useCategories } from '@/data/queries'
import {
  calculateCategoryUsages,
  calculateOverallBudgetUsage,
} from '@/domain/budget/calculateBudgetUsage'
import { calculateSavingsRate } from '@/domain/analytics/analytics'
import { calculateGoalProgress } from '@/domain/goals/goals'
import { format } from '@/domain/money/format'
import { daysRemaining } from '@/domain/period/BudgetPeriod'
import { relativeDayLabel } from '@/domain/period/labels'
import { amountOwed, netWorth } from '@/domain/transactions/accounts'
import { aggregateByCategory } from '@/domain/transactions/aggregateByCategory'
import { netIncome, netSpending } from '@/domain/transactions/PeriodSummary'
import { directionOf } from '@/domain/transactions/types'
import { cn } from '@/lib/cn'

import { WidgetFrame, type WidgetProps } from './WidgetFrame'

// ---------------------------------------------------------------------------

export function BudgetStatusWidget({ state }: WidgetProps) {
  const categories = useCategories()
  const { snapshot, today, locale } = state

  const view = useMemo(() => {
    if (
      snapshot === undefined ||
      today === null ||
      snapshot.plan === null ||
      snapshot.summary === null
    )
      return null
    const { plan, summary } = snapshot
    const overall = calculateOverallBudgetUsage({
      plan,
      variableSpent: summary.variable,
      variableRefunded: summary.variableRefund,
      today,
      period: plan.period,
    })
    const rows = calculateCategoryUsages({
      categories: categories.data ?? [],
      limits: snapshot.limits,
      totals: summary.byCategory,
      currency: plan.expectedIncome.currency,
      today,
      period: plan.period,
    }).filter((row) => row.status !== 'no_limit')
    return { overall, rows: rows.slice(0, 4), daysLeft: daysRemaining(plan.period, today) }
  }, [snapshot, today, categories.data])

  return (
    <WidgetFrame
      id="budget-status"
      title="Budget"
      state={state}
      action={
        <Link to="/budget" className="text-sm font-medium text-brand hover:underline">
          Open budget
        </Link>
      }
    >
      {() =>
        view === null || (view.overall.status === 'no_limit' && view.rows.length === 0) ? (
          <EmptyState
            title="No spending allowance yet"
            body="Set an expected income for this period and you will see how your spending is pacing against it."
            action={
              <Link className="font-medium text-brand hover:underline" to="/budget">
                Plan this period
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-text">
                  <Money value={view.overall.spentNet} locale={locale} className="font-semibold" />
                  {view.overall.limit !== null && (
                    <span className="text-text-muted">
                      {' '}
                      of <Money value={view.overall.limit} locale={locale} /> for spending
                    </span>
                  )}
                </p>
                <BudgetStatusBadge status={view.overall.status} />
              </div>
              <ProgressBar
                ratio={view.overall.usageRatio}
                marker={view.overall.elapsedRatio}
                tone={budgetStatusTone(view.overall.status)}
                label="Spending against this period's budget"
              />
              <p className="text-xs text-text-muted">
                The tick marks how far through the period you are · {view.daysLeft}{' '}
                {view.daysLeft === 1 ? 'day' : 'days'} left
              </p>
            </div>
            {view.rows.length > 0 && (
              <ul className="flex flex-col gap-3">
                {view.rows.map((row) => (
                  <li key={row.category.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-text">{row.category.name}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-text-muted">
                          <Money value={row.spentNet} locale={locale} />
                          {row.limit !== null && (
                            <>
                              {' / '}
                              <Money value={row.limit} locale={locale} />
                            </>
                          )}
                        </span>
                        <BudgetStatusBadge status={row.status} />
                      </span>
                    </div>
                    <ProgressBar
                      ratio={row.usageRatio}
                      marker={row.elapsedRatio}
                      tone={budgetStatusTone(row.status)}
                      label={`${row.category.name} budget used`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      }
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------

export function BalancesWidget({ state }: WidgetProps) {
  const { snapshot, locale, currency } = state
  return (
    <WidgetFrame
      id="balances"
      title="Balances"
      state={state}
      action={
        <Link to="/wallets" className="text-sm font-medium text-brand hover:underline">
          Wallets
        </Link>
      }
    >
      {() =>
        snapshot === undefined || snapshot.accounts.length === 0 ? (
          <EmptyState
            icon={<Landmark className="size-6" />}
            title="No accounts yet"
            body="Add where your money sits to see balances here."
            action={
              <Link className="font-medium text-brand hover:underline" to="/settings/accounts">
                Add an account
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs text-text-muted">Net worth across accounts</p>
              <Money
                value={netWorth(snapshot.accounts, currency)}
                locale={locale}
                className="text-2xl font-semibold text-text"
              />
            </div>
            <ul className="divide-y divide-border">
              {snapshot.accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <AccountIcon type={account.type} identityKey={account.id} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text">{account.name}</span>
                    <span className="text-xs text-text-muted">
                      {ACCOUNT_TYPE_LABEL[account.type]}
                    </span>
                  </span>
                  {account.type === 'credit_card' ? (
                    <span className="text-right">
                      <span className="block text-xs text-text-muted">Owed</span>
                      <Money
                        value={amountOwed(account.balance)}
                        locale={locale}
                        className="font-semibold"
                      />
                    </span>
                  ) : (
                    <Money
                      value={account.balance}
                      locale={locale}
                      tone={account.balance.minor < 0n ? 'negative' : 'default'}
                      className="font-semibold"
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      }
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------

export function MonthSummaryWidget({ state }: WidgetProps) {
  const { snapshot, locale } = state
  return (
    <WidgetFrame id="month-summary" title="This period" state={state}>
      {() => {
        const summary = snapshot?.summary ?? null
        if (summary === null) {
          return (
            <EmptyState
              title="Nothing yet"
              body="Income and spending for this period will add up here."
            />
          )
        }
        const spending = netSpending(summary)
        const net = netIncome(summary)
        const rate = calculateSavingsRate({ income: summary.income, expenses: spending })
        return (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-2.5">
              <PeriodTile
                label="Income"
                icon={<ArrowDownLeft className="size-4" />}
                iconClassName="bg-positive/10 text-positive"
              >
                <Money
                  value={summary.income}
                  locale={locale}
                  tone="positive"
                  className="text-base font-semibold"
                />
              </PeriodTile>
              <PeriodTile
                label="Spending"
                icon={<ArrowUpRight className="size-4" />}
                iconClassName="bg-surface-2 text-text-muted"
              >
                <Money value={spending} locale={locale} className="text-base font-semibold" />
              </PeriodTile>
              <PeriodTile
                label="Left over"
                icon={<PiggyBank className="size-4" />}
                iconClassName="bg-brand/10 text-brand"
              >
                <Money
                  value={net}
                  locale={locale}
                  tone={net.minor < 0n ? 'negative' : 'default'}
                  className="text-base font-semibold"
                />
              </PeriodTile>
              <PeriodTile
                label="Kept"
                icon={<Percent className="size-4" />}
                iconClassName="bg-brand/10 text-brand"
              >
                <span className="text-base font-semibold text-text tabular">
                  {rate.status === 'ok' ? `${Math.round(rate.rate * 100)}%` : '—'}
                </span>
              </PeriodTile>
            </dl>
            {summary.transfers.minor > 0n && (
              <p className="flex items-start gap-2 rounded-lg bg-surface-2 p-2.5 text-xs text-text-muted">
                <ArrowLeftRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <Money value={summary.transfers} locale={locale} /> moved between your own
                  accounts — counted as neither income nor spending.
                </span>
              </p>
            )}
          </div>
        )
      }}
    </WidgetFrame>
  )
}

/** One figure of the period, as a small tile with its icon. */
function PeriodTile({
  label,
  icon,
  iconClassName,
  children,
}: {
  readonly label: string
  readonly icon: ReactNode
  readonly iconClassName: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-bg p-3">
      <dt className="flex items-center gap-2 text-xs text-text-muted">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-lg',
            iconClassName,
          )}
        >
          {icon}
        </span>
        {label}
      </dt>
      <dd className="truncate">{children}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function SpendingBreakdownWidget({ state }: WidgetProps) {
  const { snapshot, locale, currency } = state
  return (
    <WidgetFrame
      id="spending-breakdown"
      title="Where it went"
      state={state}
      action={
        <Link to="/insights" className="text-sm font-medium text-brand hover:underline">
          Insights
        </Link>
      }
    >
      {() => {
        const summary = snapshot?.summary ?? null
        const { total, slices } = aggregateByCategory({
          totals: summary?.byCategory ?? [],
          currency,
          top: 5,
        })
        if (slices.length === 0) {
          return (
            <EmptyState
              title="No spending yet this period"
              body="Add an expense and you will see where it goes."
            />
          )
        }
        return (
          <CategoryDonut
            ariaLabel={`Spending by category: ${slices.map((slice) => `${slice.name} ${Math.round(slice.share * 100)}%`).join(', ')}`}
            centerLabel="Spent"
            centerValue={format(total, locale)}
            slices={slices.map((slice) => ({
              key: slice.categoryId,
              label: slice.name,
              share: slice.share,
              color: slice.color,
              valueText: <Money value={slice.net} locale={locale} />,
            }))}
          />
        )
      }}
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------

export function GoalsWidget({ state }: WidgetProps) {
  const { snapshot, locale } = state
  return (
    <WidgetFrame
      id="goals"
      title="Goals"
      state={state}
      bare
      action={
        <Link to="/goals" className="text-sm font-medium text-brand hover:underline">
          See all
        </Link>
      }
    >
      {() =>
        snapshot === undefined || snapshot.goals.length === 0 ? (
          <Card>
            <EmptyState
              title="No goals yet"
              body="A goal gives money a purpose: a wallet you move savings into."
              action={
                <Link className="font-medium text-brand hover:underline" to="/goals?new=1">
                  Create a goal
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {snapshot.goals.slice(0, 4).map((goal) => {
              const progress = calculateGoalProgress(goal)
              const percent = Math.round(progress.displayRatio * 100)
              return (
                <li key={goal.id} className="min-w-0">
                  <Link
                    to={`/goals/${goal.id}`}
                    className={cn(
                      CARD_CLASS,
                      'flex h-full flex-col gap-2 p-3.5 transition-colors duration-150 hover:bg-surface-2 sm:p-4',
                    )}
                  >
                    <span className="flex items-start justify-between gap-1">
                      <span className="min-w-0 truncate text-xs font-medium text-text-muted">
                        {goal.name}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-text-muted"
                      />
                    </span>
                    <span className="flex flex-col">
                      <Money
                        value={goal.balance}
                        locale={locale}
                        className="text-lg font-semibold"
                      />
                      <span className="text-xs text-text-muted">
                        of <Money value={goal.target} locale={locale} />
                      </span>
                    </span>
                    <ProgressBar
                      ratio={progress.displayRatio}
                      label={`${goal.name}: ${percent}% saved`}
                      className="mt-auto h-1.5"
                      {...(progress.isAchieved
                        ? { tone: 'positive' as const }
                        : { fillClassName: identityFill(identityOf(goal.walletAccountId)) })}
                    />
                    {progress.isAchieved && (
                      <span className="text-xs font-medium text-positive">Reached</span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )
      }
    </WidgetFrame>
  )
}

// ---------------------------------------------------------------------------

const KIND_LABEL = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  refund: 'Refund',
} as const

export function RecentTransactionsWidget({ state }: WidgetProps) {
  const location = useLocation()
  const { snapshot, today, locale } = state
  return (
    <WidgetFrame
      id="recent-transactions"
      title="Recent activity"
      state={state}
      bare
      action={
        <Link to="/transactions" className="text-sm font-medium text-brand hover:underline">
          See all
        </Link>
      }
    >
      {() =>
        snapshot === undefined || today === null || snapshot.recent.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing logged yet"
              body="Your first expense takes about ten seconds."
              action={
                <Link
                  to="/transactions/new"
                  state={{ background: location }}
                  className="font-medium text-brand hover:underline"
                >
                  Add a transaction
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.recent.map((row) => (
              <li key={row.id}>
                <Link
                  to={`/transactions/${row.id}/edit`}
                  state={{ background: location }}
                  className={ROW_CARD_CLASS}
                >
                  <TransactionRow
                    title={
                      row.merchantLabel ||
                      row.description ||
                      row.categoryName ||
                      KIND_LABEL[row.kind]
                    }
                    subtitle={`${relativeDayLabel(row.occurredOn, today, locale)} · ${
                      row.kind === 'transfer'
                        ? `${row.accountName} → ${row.counterAccountName ?? ''}`
                        : row.accountName
                    }`}
                    amount={row.amount}
                    direction={directionOf({
                      kind: row.kind,
                      accountId: '',
                      counterAccountId: null,
                    })}
                    icon={row.categoryIcon}
                    color={row.categoryColor}
                    isTransfer={row.kind === 'transfer'}
                    isSplit={row.isSplit}
                    locale={locale}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    </WidgetFrame>
  )
}
