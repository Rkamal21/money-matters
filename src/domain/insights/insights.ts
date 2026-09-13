import { compareToPreviousPeriod } from '../analytics/analytics'
import type { BudgetUsage, CategoryUsage } from '../budget/calculateBudgetUsage'
import { format } from '../money/format'
import { isPositive, max, subtract, type Money, zero } from '../money/Money'
import type { CategoryTotal } from '../transactions/PeriodSummary'

/**
 * Insights — the interpretation layer above analytics (FINANCIAL-ENGINE.md §7).
 *
 * `InsightProvider` is the whole of the AI extension point: rules now,
 * a model later, the same interface, the same widget (ARCHITECTURE.md §H).
 *
 * The rule the provider may never break: an insight never fabricates a
 * number. With too little history it says so (PRODUCT.md §3).
 */

export type InsightSeverity = 'positive' | 'info' | 'caution'

export interface Insight {
  readonly id: string
  readonly severity: InsightSeverity
  readonly title: string
  readonly body: string
  readonly action?: { readonly label: string; readonly route: string }
}

export interface FinancialSnapshot {
  readonly currency: string
  readonly locale: string
  /** 0..1 of the current period gone. */
  readonly elapsedRatio: number
  readonly current: {
    readonly income: Money
    readonly spending: Money
    readonly byCategory: readonly CategoryTotal[]
  }
  /** `null` before the user has a completed previous period. */
  readonly previous: {
    readonly income: Money
    readonly spending: Money
    readonly byCategory: readonly CategoryTotal[]
  } | null
  readonly categoryUsage: readonly CategoryUsage[]
  readonly overall: BudgetUsage | null
  readonly hasExpectedIncome: boolean
  readonly goalsBehind: readonly { readonly name: string; readonly id: string }[]
}

export interface InsightProvider {
  readonly id: string
  generate(snapshot: FinancialSnapshot): Promise<Insight[]>
}

type Rule = (snapshot: FinancialSnapshot) => Insight | Insight[] | null

function netOf(row: CategoryTotal, currency: string): Money {
  return max(zero(currency), subtract(row.expense, row.refund))
}

/** A category up sharply on last period — only once there is a last period, and only for real money. */
const categoryChanges: Rule = (snapshot) => {
  if (snapshot.previous === null) return null
  const previousById = new Map(snapshot.previous.byCategory.map((row) => [row.categoryId, row]))
  const out: Insight[] = []

  for (const row of snapshot.current.byCategory) {
    if (row.kind !== 'expense') continue
    const previousRow = previousById.get(row.categoryId)
    if (previousRow === undefined) continue
    const current = netOf(row, snapshot.currency)
    const previous = netOf(previousRow, snapshot.currency)
    const comparison = compareToPreviousPeriod({ current, previous })
    if (comparison.status !== 'ok') continue
    // At least ₹500 of difference and 20%: smaller moves are noise, not news.
    if (comparison.delta.minor < 50_000n && comparison.delta.minor > -50_000n) continue
    if (comparison.percent >= 20) {
      out.push({
        id: `category-up:${row.categoryId}`,
        severity: 'caution',
        title: `${row.name} is up ${Math.round(comparison.percent)}%`,
        body: `You've spent ${format(current, snapshot.locale)} on ${row.name} this period, against ${format(previous, snapshot.locale)} last period.`,
        action: { label: 'See transactions', route: `/transactions?category=${row.categoryId}` },
      })
    } else if (comparison.percent <= -20 && snapshot.elapsedRatio >= 0.8) {
      out.push({
        id: `category-down:${row.categoryId}`,
        severity: 'positive',
        title: `${row.name} is down ${Math.abs(Math.round(comparison.percent))}%`,
        body: `${format(current, snapshot.locale)} this period against ${format(previous, snapshot.locale)} last time.`,
      })
    }
  }
  return out.slice(0, 2)
}

/** A budget running ahead of the calendar: actionable before the money is gone. */
const paceWarnings: Rule = (snapshot) =>
  snapshot.categoryUsage
    .filter((usage) => usage.status !== 'no_limit' && usage.status !== 'exceeded')
    .filter((usage) => usage.pace === 'ahead' && usage.usageRatio >= 0.5)
    .slice(0, 2)
    .map((usage) => ({
      id: `pace:${usage.category.id}`,
      severity: 'caution' as const,
      title: `${usage.category.name} is running fast`,
      body: `${Math.round(usage.usageRatio * 100)}% of the limit used with ${Math.round(usage.elapsedRatio * 100)}% of the period gone.`,
      action: { label: 'Open budget', route: '/budget' },
    }))

const overLimit: Rule = (snapshot) =>
  snapshot.categoryUsage
    .filter((usage) => usage.status === 'exceeded' && usage.remaining !== null)
    .slice(0, 2)
    .map((usage) => ({
      id: `over:${usage.category.id}`,
      severity: 'caution' as const,
      title: `${usage.category.name} is over its limit`,
      body: `Over by ${format(subtract(usage.spentNet, usage.limit ?? usage.spentNet), snapshot.locale)}. The limit is advice, not a lock — adjust it or ease off.`,
      action: { label: 'Open budget', route: '/budget' },
    }))

const savingsSoFar: Rule = (snapshot) => {
  const { income, spending } = snapshot.current
  if (!isPositive(income)) return null
  const saved = subtract(income, spending)
  if (!isPositive(saved)) return null
  const percent = Math.round((Number(saved.minor) / Number(income.minor)) * 100)
  if (percent < 10) return null
  return {
    id: 'savings-rate',
    severity: 'positive',
    title: `You've kept ${percent}% of this period's income`,
    body: `${format(saved, snapshot.locale)} of ${format(income, snapshot.locale)} is still yours after spending.`,
  }
}

const noBudget: Rule = (snapshot) =>
  snapshot.hasExpectedIncome
    ? null
    : {
        id: 'set-budget',
        severity: 'info',
        title: 'Set an expected income',
        body: 'Your safe daily limit needs to know what is coming in this period.',
        action: { label: 'Plan budget', route: '/budget' },
      }

const goalsBehind: Rule = (snapshot) =>
  snapshot.goalsBehind.slice(0, 1).map((goal) => ({
    id: `goal-behind:${goal.id}`,
    severity: 'caution' as const,
    title: `${goal.name} is behind schedule`,
    body: 'At your recent pace it will miss its target date.',
    action: { label: 'Open goal', route: `/goals/${goal.id}` },
  }))

const needsHistory: Rule = (snapshot) =>
  snapshot.previous === null
    ? {
        id: 'needs-history',
        severity: 'info',
        title: 'Comparisons unlock next period',
        body: 'Keep tracking — once a full period is behind you, this card compares it with the current one.',
      }
    : null

const RULES: readonly Rule[] = [
  noBudget,
  overLimit,
  paceWarnings,
  categoryChanges,
  goalsBehind,
  savingsSoFar,
  needsHistory,
]

/** The M8 provider: a list of small rules. Adding an insight is one new rule. */
export const RuleBasedInsightProvider: InsightProvider = {
  id: 'rules',
  generate(snapshot) {
    const insights = RULES.flatMap((rule) => {
      const result = rule(snapshot)
      if (result === null) return []
      return Array.isArray(result) ? result : [result]
    })
    return Promise.resolve(insights.slice(0, 6))
  },
}
