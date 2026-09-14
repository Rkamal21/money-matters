/**
 * Query keys — ARCHITECTURE.md §J. Centralised so invalidation is greppable:
 * a mutation that affects the period summary invalidates `['period-summary']`,
 * and it is obvious from this one file which mutations should.
 */
export const queryKeys = {
  session: () => ['session'] as const,
  profile: () => ['profile'] as const,
  accounts: () => ['accounts'] as const,
  categories: () => ['categories'] as const,
  merchantRules: () => ['merchant-rules'] as const,
  transactions: (filter?: unknown) =>
    filter === undefined ? (['transactions'] as const) : (['transactions', filter] as const),
  transaction: (id: string) => ['transactions', 'detail', id] as const,
  periodSummary: (from?: string, to?: string) =>
    from === undefined ? (['period-summary'] as const) : (['period-summary', from, to] as const),
  budget: (periodKey?: string) =>
    periodKey === undefined ? (['budget'] as const) : (['budget', periodKey] as const),
  budgetPeriods: () => ['budget', 'periods'] as const,
  goals: () => ['goals'] as const,
  goal: (id: string) => ['goals', id] as const,
  goalActivity: (id: string) => ['goals', id, 'activity'] as const,
  gamification: () => ['gamification'] as const,
  achievements: () => ['gamification', 'achievements'] as const,
  xpEvents: () => ['gamification', 'events'] as const,
  dashboard: (today?: string) =>
    today === undefined ? (['dashboard'] as const) : (['dashboard', today] as const),
  analytics: (...parts: readonly unknown[]) => ['analytics', ...parts] as const,
} as const

/**
 * Everything a change to the ledger can move. A transaction write touches
 * balances, totals, budgets, goals, XP and the dashboard at once, so one list
 * is the honest answer.
 */
export const LEDGER_KEYS = [
  queryKeys.transactions(),
  queryKeys.accounts(),
  queryKeys.periodSummary(),
  queryKeys.budget(),
  queryKeys.goals(),
  queryKeys.gamification(),
  queryKeys.dashboard(),
  queryKeys.analytics(),
] as const
