# Money Matters 2.0 — Service & API Contracts

Status: **Proposed** · Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) · Date: 2026-09-07

There is no HTTP API of our own. The "API" of this system has three layers, and this document
defines all three:

```
features/**            calls →  Application services   (validate, orchestrate, map errors)
services/repositories  calls →  Repository interfaces  (the contract features depend on)
data/supabase          calls →  PostgREST + RPC        (the wire protocol; one directory knows it)
```

**The rule:** `import { supabase }` appears in exactly one directory (`src/data/supabase/`).
Everything above it depends on an interface. That is what keeps a future migration off Supabase, or
a swap to a real HTTP tier, from touching feature code — and it is enforced by an ESLint boundary
rule, not by convention ([ARCHITECTURE.md §F.4](./ARCHITECTURE.md)).

---

## 1. Shared types

```ts
type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

type UserId = Brand<string, 'UserId'>;   // and TransactionId, AccountId, GoalId, CategoryId…
type Page<T> = { items: T[]; nextCursor: string | null; totalEstimate?: number };

interface Ctx { userId: UserId; today: LocalDate; tz: IanaZone; currency: CurrencyCode }
```

Every service takes `unknown` input and validates it with Zod. Typing an argument as
`CreateTransactionInput` does not make the value that shape at runtime — a form, a URL parameter,
and a restored offline queue entry all arrive as `unknown`.

Every repository method is `(…) => Promise<T>` and throws `AppError`; every **service** method is
`(…) => Promise<Result<T, AppError>>`. Repositories throw because a data-layer failure is
exceptional; services return `Result` because a validation failure is an expected outcome that the
UI must render, not an exception to catch.

---

## 2. Application services

Each service is a module of functions taking `(input: unknown, deps)`. Dependencies are injected,
so every service is unit-testable against fake repositories with no network and no database.

### 2.1 `AuthService`

Thin wrapper over Supabase Auth; exists so no feature imports `supabase.auth` directly and so error
mapping happens in one place.

| Operation | Input | Output | Errors | Authorization |
|---|---|---|---|---|
| `signUp` | `{ email, password, displayName }` | `{ userId, needsEmailConfirmation: boolean }` | `validation` (weak password, malformed email), `conflict` (already registered — surfaced as the same generic message as success, to avoid enumeration), `network` | public |
| `signIn` | `{ email, password }` | `{ session }` | `authentication` (one generic message), `rate_limited`, `network` | public |
| `signOut` | `{ scope?: 'local' \| 'global' }` | `void` | `network` | authenticated |
| `requestPasswordReset` | `{ email }` | `void` (always succeeds from the caller's view) | `rate_limited`, `network` | public |
| `updatePassword` | `{ password }` | `void` | `validation`, `authentication` (link expired) | recovery session |
| `getSession` / `onAuthStateChange` | — | `Session \| null` | — | — |
| `deleteAccount` | `{ confirmation: string }` | `void` | `validation`, `authentication` | authenticated; runs in an Edge Function under `service_role` |

`signOut` also calls `queryClient.clear()`. Leaving another user's balances in the cache on a shared
device is a data-exposure bug, not a caching detail.

### 2.2 `ProfileService`

| Operation | Input | Output | Errors | Authorization |
|---|---|---|---|---|
| `getProfile` | — | `Profile` | `not_found`, `data_access` | own row (RLS) |
| `updateProfile` | `{ displayName?, timezone?, currency?, locale?, budgetPeriodStartDay?, gamificationEnabled? }` | `Profile` | `validation` (invalid IANA zone, `startDay` outside 1–28), `data_access` | own row |
| `completeOnboarding` | `{ … }` | `Profile` | `validation`, `conflict` | own row |

Changing `timezone` or `budgetPeriodStartDay` re-derives every period boundary but **never rewrites
stored `occurred_on` values** — see [FINANCIAL-ENGINE.md §2.3](./FINANCIAL-ENGINE.md). The UI states
this before saving.

### 2.3 `AccountService`

| Operation | Input | Output | Errors | Authorization |
|---|---|---|---|---|
| `listAccounts` | `{ includeArchived?: boolean }` | `AccountWithBalance[]` | `data_access` | own |
| `createAccount` | `{ name, type, openingBalanceMinor, currency, creditLimitMinor?, institution?, last4? }` | `Account` | `validation` (blank name, credit limit on a non-card, `last4` not 4 digits), `conflict` (duplicate name) | own |
| `updateAccount` | `{ id, patch, expectedUpdatedAt }` | `Account` | `validation`, `not_found`, `conflict` (concurrent edit) | own |
| `archiveAccount` | `{ id }` | `Account` | `not_found` | own |
| `deleteAccount` | `{ id }` | `void` | `conflict` (**has transactions — archive instead**), `not_found` | own |
| `getBalances` | — | `Map<AccountId, Money>` | `data_access` | own |

Balances come from the `account_balances` view, never from a stored column and never from summing
rows in the browser.

### 2.4 `CategoryService`

| Operation | Input | Output | Errors |
|---|---|---|---|
| `listCategories` | `{ kind?, includeArchived? }` | `Category[]` | `data_access` |
| `createCategory` | `{ name, kind, treatment, icon, color }` | `Category` | `validation`, `conflict` (slug exists) |
| `updateCategory` | `{ id, patch }` | `Category` | `validation`, `not_found`, `authorization` (attempt to change `is_system` or `slug` → `42501`) |
| — | — | — | `createCategory` likewise: sending `is_system` or `slug` is `42501`, not a silently ignored field ([ADR-0019](./adr/0019-insert-column-grants.md)) |
| `archiveCategory` | `{ id }` | `Category` | `not_found` |
| `deleteCategory` | `{ id }` | `void` | `conflict` (in use, or system category) |
| `reorderCategories` | `{ orderedIds }` | `Category[]` | `validation` |

`slug` is generated from `name` on creation and then immutable. Renaming is free; the slug is what
merchant rules and seeds bind to. It is derived **server-side**, by the `set_category_slug()`
`BEFORE INSERT` trigger — the client neither sends it nor may send it, which is why
`createCategory` has no `slug` field and why `slug` is absent from both column grants.

### 2.5 `TransactionService`

The most-used service. `create` is the highest-traffic write in the product.

```ts
createTransaction(input: unknown, deps): Promise<Result<Transaction, AppError>>
```

| Field | Validation |
|---|---|
| `kind` | one of `expense \| income \| transfer \| refund` |
| `amount` | parsed by `parseAmount`; **> 0**; ≤ ₹9 × 10^11; currency matches the account |
| `accountId` | exists, not archived, owned (enforced again by the composite FK) |
| `counterAccountId` | required **iff** `kind = 'transfer'`; must differ from `accountId` |
| `categoryId` | required unless transfer or split; must match `kind`'s category kind |
| `splits` | if present, ≥ 2 entries, each > 0, summing exactly to `amount`, distinct categories |
| `occurredOn` | a valid `LocalDate`; not before 2000-01-01; not more than 1 year in the future (client rule; the server allows 5) |
| `description` | ≤ 280 chars, trimmed |
| `clientRequestId` | UUID generated **once per form submission** and reused on every retry |

| Operation | Output | Errors | Notes |
|---|---|---|---|
| `createTransaction` | `Transaction` | `validation`, `conflict` (duplicate `clientRequestId` → returns the existing row, treated as success by the UI), `authorization`, `network` | Splits are written in the same request; the deferred constraint validates the total at commit |
| `updateTransaction` | `Transaction` | `validation`, `not_found`, `conflict` (concurrent edit via `expectedUpdatedAt`) | changing `kind` to/from `transfer` re-validates the whole shape |
| `deleteTransaction` | `void` | `not_found` | soft delete (`deleted_at`) with a 30-day undo window |
| `listTransactions` | `Page<Transaction>` | `data_access` | keyset pagination on `(occurred_on desc, id desc)` — **never** `OFFSET`, which drifts as rows are inserted |
| `getTransaction` | `Transaction \| null` | — | |
| `sumByCategory(period)` | `CategoryTotal[]` | `data_access` | **RPC** — aggregated in Postgres |
| `sumForPeriod(period)` | `PeriodTotals` | `data_access` | **RPC** |

`TransactionFilter`: `{ from?, to?, kinds?, categoryIds?, accountIds?, statuses?, query?, minAmount?, maxAmount?, cursor?, limit? }` — mirrored exactly by the URL search params, so a filtered view is a shareable link.

### 2.6 `BudgetService`

| Operation | Input | Output | Errors |
|---|---|---|---|
| `getCurrentPeriod` | `{ today }` | `BudgetPeriod` | `data_access` |
| `ensurePeriod` | `{ today }` | `BudgetPeriod` | `data_access` | **RPC**, idempotent, carries the previous plan and rollover forward |
| `getPeriod` | `{ periodKey }` | `BudgetPeriod \| null` | `not_found` |
| `updatePlan` | `{ periodId, expectedIncome?, plannedFixed?, plannedSavings?, overallLimit?, rolloverEnabled?, expectedUpdatedAt }` | `BudgetPeriod` | `validation` (negative amounts), `conflict` (**period closed** → `42501`, or concurrent edit) |
| `setCategoryLimit` | `{ periodId, categoryId, limit }` | `BudgetCategoryLimit` | `validation`, `conflict` |
| `removeCategoryLimit` | `{ periodId, categoryId }` | `void` | `not_found` |
| `getUsage` | `{ periodId }` | `BudgetUsage` | `data_access` | totals from `get_period_summary`; ratios and status from `domain/budget` |
| `listPeriods` | `{ limit }` | `BudgetPeriod[]` | | budget history |

### 2.7 `GoalService`

A goal is the *purpose* of money in one wallet; its progress is that wallet's balance
([ADR-0026](./adr/0026-goals-are-the-purpose-of-a-wallet.md)).

| Operation | Input | Output | Errors | Notes |
|---|---|---|---|---|
| `listGoals` | `{ includeArchived? }` | `GoalWithProgress[]` | `data_access` | read from the `goal_progress` view — balance, `reached`, `reachedOn` |
| `createGoal` | `{ name, target, walletAccountId, targetDate?, priority? }` | `Goal` | `validation` (target ≤ 0, target date in the past, **account is not the user's wallet** → `23503`), `conflict` (**wallet already backs a goal** → `23505`) | the form may first `createAccount({ type: 'wallet' })`; if the goal write then fails, the empty wallet remains and the form retries against it |
| `updateGoal` | `{ id, patch, expectedUpdatedAt }` | `Goal` | `validation`, `not_found`, `conflict`, `authorization` (changing `walletAccountId` → `42501`; it is insert-only) | |
| `archiveGoal` | `{ id }` | `Goal` | `not_found` | the wallet and its money are untouched |
| `listGoalActivity` | `{ goalId, cursor? }` | `Page<Transaction>` | `not_found` | `listTransactions` filtered to the goal's wallet — the activity *is* the wallet's ledger |
| `contributeToGoal` | `{ goalId, amount, fromAccountId, occurredOn, clientRequestId }` | `Transaction` | as `createTransaction` | `createTransaction({ kind: 'transfer', accountId: fromAccountId, counterAccountId: <goal's wallet> })`. Withdrawing is the reverse transfer |

**There is no `setGoalAmount` and no `addContribution`, by design.** A goal stores no amount, so
there is nothing for a client to set, and progress moves only when money moves between accounts.
That closes v1's "set your own savings balance" hole structurally rather than with a grant: the
column it would need does not exist.

### 2.8 `GamificationService`

| Operation | Input | Output | Errors |
|---|---|---|---|
| `getProfile` | — | `{ xpTotal, level, xpToNext, currentStreak, longestStreak, lastCheckInOn }` | `data_access` |
| `checkIn` | `{ today }` | `{ profile, xpAwarded, streakChanged }` | `validation` (date outside the accepted window) | **RPC** `daily_check_in` |
| `listAchievements` | — | `Achievement[]` (catalog + unlocked state) | `data_access` |
| `listEvents` | `{ cursor? }` | `Page<GamificationEvent>` | `data_access` | the user can see exactly why they have the XP they have |

**There is no `awardXp`.** No client-callable path grants XP. Every award is a trigger or a
`SECURITY DEFINER` function, deduplicated by `(user_id, dedupe_key)`.

### 2.9 `AnalyticsService`

| Operation | Input | Output |
|---|---|---|
| `getPeriodSummary` | `{ from, to }` | `{ income, expense, fixed, variable, refunds, net, byCategory[] }` — **RPC** |
| `getSpendingOverTime` | `{ from, to, granularity: 'day' \| 'week' \| 'month' }` | `TimeSeries` — **RPC**, gaps zero-filled |
| `getMonthlyComparison` | `{ months: number }` | `PeriodComparison[]` — **RPC** |
| `getSavingsRate` | `{ from, to }` | `{ status: 'ok', rate } \| { status: 'undefined' }` |
| `getCategoryTrends` | `{ categoryIds, months }` | `TimeSeries[]` |

Every one returns **aggregates**, never rows. A method that would return more than ~500 rows to the
client is a design error in this layer, not a pagination problem.

### 2.10 `CategorizationService`

The pipeline the brief asks for, as one pure module plus one repository call:

```
merchant text
  → normalize()          strip UPI handles, ref numbers, trailing city/POS codes,
  │                      collapse whitespace, lowercase, drop punctuation
  → matchRules()         rules ordered by (priority, specificity); first match wins
  → CategorySuggestion   { categorySlug, merchantLabel, confidence, ruleId, source }
  → resolve()            slug → the user's own category id
  → apply or ask         confidence ≥ 0.9 → pre-fill; below → suggest and ask
  → learn()              a user correction writes a personal rule at priority 10
```

```ts
interface CategorizationProvider {
  readonly id: string;
  suggest(input: { merchantRaw: string; description?: string;
                   amountMinor?: bigint; occurredOn?: LocalDate }): Promise<CategorySuggestion | null>;
}
```

`RuleBasedProvider` ships at MVP. A future `MLProvider` or `AiProvider` implements the same
interface; a `ChainProvider` tries them in order and takes the first result above a confidence
threshold. **Nothing above this interface changes** when that happens — which is the whole point of
defining it now and implementing only the boring version.

### 2.11 `InsightProvider` *(interface only at MVP — no implementation)*

```ts
interface FinancialSnapshot { period; totals; budgetUsage; goals; history; profile }
interface Insight {
  id: string; severity: 'positive' | 'info' | 'caution';
  title: string; body: string; action?: { label: string; route: string };
}
interface InsightProvider { generate(snapshot: FinancialSnapshot): Promise<Insight[]> }
```

Rules-based provider in Milestone 8, AI provider in Milestone 13, same interface, same widget.

---

## 3. Repository interfaces

The layer features actually import. Supabase classes implement them.

```ts
export interface TransactionRepository {
  list(userId: UserId, filter: TransactionFilter): Promise<Page<Transaction>>;
  getById(userId: UserId, id: TransactionId): Promise<Transaction | null>;
  create(input: CreateTransactionInput): Promise<Transaction>;
  update(id: TransactionId, patch: UpdateTransactionInput, expectedUpdatedAt: string): Promise<Transaction>;
  softDelete(id: TransactionId): Promise<void>;
  sumByCategory(userId: UserId, period: DateRange): Promise<CategoryTotal[]>;
  sumForPeriod(userId: UserId, period: DateRange): Promise<PeriodTotals>;
}
```

Two rules make the indirection worth its cost:

1. **Aggregates are computed in Postgres.** `sumByCategory` is an RPC returning grouped sums, not
   `select *` followed by `Array.reduce`. v1 fetched 100 rows and reduced them in `App.jsx`, which
   silently produced wrong totals at transaction 101 — a bug with no error message.
2. **The repository is where `bigint` becomes `Money`.** A row leaves as a domain entity; no
   feature ever sees `amount_minor`. That boundary is what makes "never float arithmetic on money"
   structurally true rather than a guideline someone has to remember.

Full list: `ProfileRepository`, `AccountRepository`, `CategoryRepository`, `TransactionRepository`,
`BudgetRepository`, `GoalRepository`, `GamificationRepository`, `MerchantRuleRepository`,
`AnalyticsRepository`.

---

## 4. Postgres RPC contracts

All are `SECURITY DEFINER` with `SET search_path = ''` and `REVOKE … FROM public, anon`.

The **client-callable** ones — everything in this section except `recompute_xp_totals` — carry
`GRANT EXECUTE … TO authenticated` and derive the caller from `auth.uid()`. They never take a user
id; a `p_user_id` parameter on a function `authenticated` can execute is a privilege-escalation
hole, and CI asserts none exists ([SECURITY.md §4.5 rule 2, §8.2](./SECURITY.md)).

`recompute_xp_totals` is a **maintenance** function: no grant to `authenticated`, reachable only
with `service_role`, and it takes an optional `p_user_id` because an operator repairing one user's
total is exactly the case it exists for.
`evaluate_achievements(p_user_id)` is **internal**: no grant at all, called only from inside
another definer function that has already derived the caller.

Every definer function here is owned by a role holding `BYPASSRLS`. That is not incidental — a
definer function whose owner lacks it reads an RLS-filtered ledger and writes a silently wrong
total, with no error. See [ADR-0020](./adr/0020-rls-execution-model.md).

There is **no goal RPC**. A contribution is a transfer written through PostgREST like any other
transaction; its XP comes from the transaction trigger ([ADR-0026](./adr/0026-goals-are-the-purpose-of-a-wallet.md)).

### `ensure_budget_period`

```sql
ensure_budget_period(p_today date) returns public.budget_periods
```

Idempotent. Computes the period containing `p_today` from `profiles.budget_period_start_day`,
inserts it if missing with `ON CONFLICT DO NOTHING`, carries forward the previous period's plan and
(if enabled) its rollover, and closes any period whose `endExclusive <= p_today`. Safe to call on
every app launch and from two devices at once. Errors: `28000`, `22007 invalid_date`.

### `get_period_summary`

```sql
get_period_summary(p_from date, p_to date) returns table (
  income_minor bigint, expense_minor bigint, refund_minor bigint,
  fixed_minor bigint, variable_minor bigint,
  transfer_in_minor bigint, transfer_out_minor bigint,
  by_category jsonb   -- [{ category_id, slug, name, amount_minor, txn_count }]
)
```

Transfers are reported separately and are **excluded** from income and expense — the structural
guarantee that moving ₹10,000 to savings never reads as ₹10,000 of spending. Range is capped at
400 days to bound the work.

### `get_dashboard_snapshot`

```sql
get_dashboard_snapshot(p_today date) returns jsonb
```

One round trip for the whole dashboard: period, plan, totals, per-category usage, account balances,
goal summaries, gamification profile. Replaces a seven-request waterfall on the slowest screen on
the slowest network. Its shape is validated client-side by a Zod schema — an RPC returning `jsonb`
is untyped at the boundary and must be parsed like any other untrusted input.

### `daily_check_in`

```sql
daily_check_in(p_today date) returns public.gamification_profiles
```

Streak transition computed in SQL from `last_check_in_on`. Clamps to at most one increment, rejects
`p_today < last_check_in_on` and any `p_today` more than one day from the server's date — so a
manipulated device clock cannot manufacture a streak. Idempotent per day via
`dedupe_key = 'check_in:' || p_today`.

### `record_transaction_review` *(Milestone 12)*

```sql
record_transaction_review(p_transaction_id uuid, p_decision text) returns public.transactions
```

`p_decision ∈ {confirm, reject, duplicate}`. Moves an ingested row out of `pending_review`, records
the decision for parser feedback, and awards XP only on `confirm`.

### `recompute_xp_totals` *(maintenance)*

```sql
recompute_xp_totals(p_user_id uuid default null) returns integer
```

Rebuilds `gamification_profiles.xp_total` from `gamification_events` — the documented recovery path
for the system's one cache, because a gamification rule that turns out to be wrong is a *when*, not
an *if* ([ARCHITECTURE.md §P, R7](./ARCHITECTURE.md)). Not granted to `authenticated`. Goal progress
needs no counterpart: it is derived from `transactions` on every read.

---

## 5. Error model

```ts
export type ErrorKind =
  | 'validation' | 'authentication' | 'authorization' | 'not_found'
  | 'conflict'   | 'rate_limited'   | 'data_access'   | 'network' | 'unexpected';

export interface AppError {
  kind: ErrorKind;
  code: string;               // stable and machine-readable: 'transaction.amount_positive'
  userMessage: string;        // safe to render. Written by us. NEVER from the database.
  fieldErrors?: Record<string, string[]>;
  correlationId: string;      // logged, and shown in the UI for support
  cause?: unknown;            // logged only, never rendered
  retryable: boolean;
}
```

### 5.1 Mapping — `data/supabase/mapErrors.ts`, the one place raw errors are touched

| Source | Kind | Example `code` |
|---|---|---|
| Zod `SafeParseError` | `validation` (+ `fieldErrors`) | `transaction.amount_positive` |
| PG `23505` unique violation | `conflict` | `transaction.duplicate_request` |
| PG `23514` check violation | `validation` (constraint name → code) | `transaction.amount_positive` |
| PG `23503` FK violation | `validation` | `transaction.unknown_category` |
| PG `23P01` exclusion violation | `conflict` | `budget.period_overlap` |
| PG `42501` insufficient privilege | `authorization` | `goal.wallet_not_writable` |
| PostgREST `PGRST301` (JWT expired) | `authentication` | `auth.session_expired` |
| PostgREST `PGRST116` (no rows) | `not_found` | `transaction.not_found` |
| PG `P0002` from an RPC | `not_found` | `transaction.not_found` |
| PG `P0001` custom raise | `validation` | mapped from the raised message key |
| GoTrue `invalid_credentials` | `authentication` | `auth.invalid_credentials` |
| GoTrue `over_request_rate_limit` | `rate_limited` | `auth.rate_limited` |
| `fetch` rejection / offline | `network` (retryable) | `net.offline` |
| anything else | `unexpected` | `app.unexpected` |

Constraint names are part of the contract: `tx_amount_positive_check` maps to
`transaction.amount_positive` maps to "Amount must be greater than zero." A table maps the three,
and a test asserts every constraint in the schema has a mapping — so a new constraint cannot ship
with a raw Postgres message as its user-facing text.

### 5.2 Presentation — `lib/errorPresenter.ts`

| Kind | UI |
|---|---|
| `validation` | Inline field errors; focus moves to the first invalid field; a form-level summary for screen readers |
| `authentication` | Redirect to `/login`, preserve `returnTo` |
| `authorization` | Full-page "not available" — **never** reveal whether the record exists |
| `not_found` | Empty state with a route back |
| `conflict` | Toast: "This changed somewhere else. Reload to see the latest." + a reload action |
| `rate_limited` | Toast with a retry-after hint |
| `network` | Toast + automatic retry with backoff; the mutation stays queued |
| `data_access` / `unexpected` | Error boundary, Sentry report, correlation id shown for support |

**The rule that matters:** a `PostgrestError.message` never reaches a rendered string. Database
messages leak schema (`column "xp_total" of relation "gamification_profiles"`), constraint names, and sometimes
row contents. `userMessage` is written by us, per `code`, in language a person understands.

### 5.3 Error flow

```
PostgreSQL raises 23514 tx_amount_positive_check
  → PostgREST 400 { code: '23514', message: 'new row … violates check constraint …' }
    → mapErrors()  →  AppError { kind:'validation', code:'transaction.amount_positive',
                                 userMessage:'Amount must be greater than zero.',
                                 fieldErrors:{ amount:['Amount must be greater than zero.'] },
                                 correlationId:'c-8f3a…', retryable:false }
      → service returns Result.err
        → mutation onError → errorPresenter
          → field error under the Amount input, focus moved, announced by role="alert"
          → Sentry: kind, code, correlationId, route.  NOT the amount, NOT the description.
```

---

## 6. What is deliberately *not* an API

| Not built | Why |
|---|---|
| A public/partner REST API | No consumer exists. Adding one now means designing versioning, keys, and rate limits for nobody. |
| A GraphQL layer | One client, one schema, no over-fetching problem that keyset pagination and RPCs do not already solve. |
| A Node/Express CRUD tier in front of Supabase | It would duplicate the authorization rules RLS already enforces, in a second place that can disagree — and add a deployment and ~80 ms per call. Edge Functions cover the only genuine need (server-held secrets). |
| Client-callable XP, balance, or goal-progress mutations | The entire point of §2.7 and §2.8. Balances and goal progress move only through `transactions`. |
| Webhooks | Nothing subscribes yet. |
