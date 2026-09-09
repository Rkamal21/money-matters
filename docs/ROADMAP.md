# Money Matters 2.0 — Development Roadmap

Status: **Proposed** · Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) · Date: 2026-09-07

Milestones are **strictly ordered**. Milestones 0–7 are the product; 8–13 are amplifiers. The test
of whether the extension points are real is that **nothing in 8–13 changes the schema of 0–7** —
if a later milestone needs a migration on a core table, an assumption was wrong and we say so.

Estimates assume 2–3 developers. They are sequencing information, not commitments.

---

## Milestone 0 — Foundation

**Scope.** Empty the runway. New Vite + React 19 + TypeScript (`strict`) project. Tailwind v4 with
the theme tokens. ESLint 9 flat config with `eslint-plugin-boundaries`, `jsx-a11y`, the
`no-restricted-imports` bans (`domain/` may not import React/Supabase; features may not import the
Supabase client), and `no-restricted-globals` for `Date` inside `domain/`. Prettier, Husky,
commitlint. Vitest + RTL + MSW + Playwright + fast-check configured and each proven with one real
test. Supabase CLI wired: `supabase/migrations/`, `seed.sql`, local start documented. GitHub Actions
running the full pipeline from [TESTING.md §8](./TESTING.md). `config/env.ts` validating environment
variables at startup. Sentry initialised with the scrubbing `beforeSend`. Folder skeleton with a
`README.md` in each top-level directory stating its responsibility.

Two small things that have no other home and are cheapest here:

- **The category-constant generation step.** [ARCHITECTURE.md §R.5](./ARCHITECTURE.md) resolves the
  slug duplication by making the SQL seed authoritative and generating the TypeScript constants
  from it in CI. That is a script plus a job; it belongs in the pipeline from the start, before
  there are two lists to drift.
- **Pick the host** (Vercel or Cloudflare Pages) and record it in the README. Preview deploys per PR
  are a Definition-of-Done dependency, so the choice cannot wait.

**Also in Milestone 0 — v1 cleanup:**
- Delete `src/**` (v1 JavaScript), `supabase_schema.sql`, `updated_app.apk`, and the committed
  `dist/`.
- **Remove `RECEIVE_SMS` and the `SmsTransactionReceiver` from the Android manifest**, and delete
  `android/app/src/main/kotlin/**`. The feature is not built, and declaring a Google Play restricted
  permission for an unimplemented feature risks rejection of any store submission
  ([SECURITY.md §9](./SECURITY.md), risk R5). The parser regexes are preserved in
  `docs/adr/0015-sms-ingestion-policy-gated.md` as reference material for Milestone 12.
- Rotate the Supabase anon key if the `.env` value has ever been shared. (It was never committed —
  `.gitignore` covered it and `git log -- .env` is empty — so this is precautionary.)

**Dependencies:** none. **Database:** none. **Backend:** CI database provisioning only.

**Tests:** one unit, one component, one integration, one E2E — each proving its layer's harness
works end to end.

**Acceptance criteria**
- [ ] `npm ci && npm run typecheck && npm run lint && npm test` is green on a clean clone
- [ ] CI runs all eight jobs from [TESTING.md §8](./TESTING.md) and blocks merge on failure
- [ ] A PR that puts `(income - fixed) / 30` in a component **fails lint**, not review
- [ ] A PR that imports `supabase` into a component **fails lint**
- [ ] `supabase db reset` works from zero and is documented in the README
- [ ] No `RECEIVE_SMS` in the manifest; no v1 source in `src/`

**Risks.** Over-configuring: two days of tooling is investment, a week is procrastination. Timebox
to three days and ship it.

---

## Milestone 1 — Authentication and onboarding

**Scope.** Sign up (with email confirmation), sign in, sign out, password reset, update password.
`AuthProvider` with a single deterministic initialisation. `RequireAuth` / `RequireOnboarding` route
guards. The four-step onboarding wizard ([PRODUCT.md §8](./PRODUCT.md)). Settings → profile
(display name, timezone, currency, period start day). Account deletion via Edge Function.

**Dependencies:** M0.

**Database.** `profiles`; `categories` table, `set_category_slug()` and its policies (needed by the
seed); **the four gamification tables plus `award_xp()` — schema only, no product surface, so that
the signup trigger and the M6 contribution RPC are complete from the start** (ADR-0016; the
surfaces land in M9); `handle_new_user()` creating profile + gamification profile + 12 seed
categories in one transaction; `is_valid_timezone()`; `set_updated_at()`; RLS for every table
created here.

> **Why gamification tables this early.** `handle_new_user()` writes a `gamification_profiles` row,
> so the table has to exist before the trigger does. Creating the tables in M9 — as an earlier draft
> of this roadmap did — made M1 unbuildable and put a cycle in the milestone graph. Four empty
> tables and one internal function are a cheap way to remove it. **Nothing user-visible ships here:**
> no XP display, no streak, no check-in, no achievement catalog.

**Frontend.** `features/auth`, `features/onboarding`, `features/settings/profile`;
`AuthLayout`; `<Field>`, `<Input>`, `<Button>`, `<Card>` from the design system.

**Tests.** RLS matrix for `profiles` and `categories`. Signup trigger creates all 14 rows
atomically. Timezone validation rejects `Mars/Olympus`. `startDay` outside 1–28 rejected. E2E:
signup → confirm → onboarding → dashboard shell. Negative: unconfirmed user cannot sign in; A cannot
read B's profile.

**Acceptance criteria**
- [ ] A new user reaches an empty dashboard with 12 categories and a gamification profile
- [ ] Session survives reload with **no** flash of the login screen (the v1 regression)
- [ ] Password reset works end to end against the local mail catcher
- [ ] `onboarding_completed_at` gates the app; a skipped optional step still leaves it usable
- [ ] Account deletion removes every row and the auth user

**Risks.** Email deliverability in dev — use the local Supabase mail catcher, never a real inbox.

---

## Milestone 2 — Accounts and the transaction ledger

The most important milestone. Everything downstream is arithmetic over this table.

**Scope.** Account CRUD with archiving. Transaction create/edit/soft-delete for `income`, `expense`,
`transfer`, and `refund`. Transaction list with keyset pagination and URL-driven filters
(date range, kind, category, account, text search). Account balances from the view. `Money` and
`LocalDate` domain modules complete.

**Dependencies:** M1.

**Database.** `accounts`; `transactions`; `transaction_splits` (schema only — the UI lands in M3);
enums; composite FKs; every index from [DATABASE.md §6.4](./DATABASE.md); `account_entries`,
`account_balances`, and `transaction_category_amounts` views; `enforce_transaction_dates`;
`enforce_split_total`; `audit_log` and its triggers.

**Frontend.** `features/accounts`, `features/transactions`; `TransactionForm` (the product's
highest-traffic surface — optimise it ruthlessly); `TransactionList`; `TransactionFilters` bound to
search params; `<Money>` component.

**Domain.** `money/**` complete with property tests; `period/LocalDate`;
`transactions/calculateBalance`; `transactions/calculateMonthlySpending`.

**Tests.** Full `Money` and `LocalDate` suites in three timezones. RLS matrix for both tables.
Constraint tests: negative amount, transfer with a category, transfer to itself, expense with a
counter account, cross-user account reference (`23503`). Idempotency: the same
`client_request_id` twice yields one row. Optimistic concurrency on edit. E2E: **the transfer
test** — ₹10,000 Bank → Savings appears in neither income nor expenses, and both balances move.

**Acceptance criteria**
- [ ] A transfer never appears as income or expense anywhere in the product
- [ ] Balances come from the view; no balance column exists
- [ ] Adding a transaction takes under 10 seconds on a phone, one-handed
- [ ] Double-tapping submit creates one transaction
- [ ] The list paginates by keyset and stays correct while rows are being inserted
- [ ] Filters live in the URL; reload and the back button both behave

**Risks.** Scope creep into splits/recurring/import. Ship the four kinds and stop.

---

## Milestone 3 — Categories, splits, and merchant categorisation

**Scope.** Category management (create, rename, archive, reorder, icon/colour, `treatment`).
Transaction splits UI. The categorisation pipeline: normalise → match → suggest → confirm → learn.
System merchant rules seeded; a user correction writes a personal rule.

**Dependencies:** M2.

**Database.** `merchant_rules` + seed rows; `categories` policies extended; category-delete
protections.

**Domain.** `transactions/categorize/**` — `normalizeMerchant`, `CategoryRule`,
`RuleBasedProvider`, the `CategorizationProvider` interface.

**Tests.** Normalisation against real Indian merchant strings (`UPI/SWIGGY/423512/PAYTM`,
`AMAZON PAY INDIA PRI`, `UBER   INDIA SYSTEMS`, `POS 1234 BIGBASKET BLR`). Rule precedence: user
beats system, higher specificity beats lower. No match returns `null`, never a guessed `Other`.
Splits: deferred constraint fires at commit; a split corrected within one transaction commits.

**Acceptance criteria**
- [ ] Typing "swiggy" suggests Food with visible confidence
- [ ] Correcting a suggestion changes future suggestions for that merchant
- [ ] A split transaction's parts sum exactly to the parent; both categories' budgets update
- [ ] A category in use cannot be deleted; archiving is offered instead
- [ ] Categorisation logic is importable and testable with zero React

**Risks.** Over-investing in the rule engine. Twenty good rules beat a clever engine with three.

---

## Milestone 4 — Budget engine

**Scope.** Period-based budgets with full history. Plan editing (expected income, planned fixed,
planned savings, overall limit). Per-category limits. Rollover. Period navigation. Budget usage and
status. Closing a period.

**Dependencies:** M3.

**Database.** `budget_periods` with the `EXCLUDE USING gist` overlap constraint;
`budget_category_limits`; `ensure_budget_period()`; `get_period_summary()`; closed-period RLS.

**Domain.** `period/BudgetPeriod` (`resolveCurrentPeriod`, `daysRemaining`, …);
`budget/calculateBudgetUsage`; `budget/budgetStatus`; rollover computation.

**Tests.** Period resolution for `startDay` 1, 15, and 28 across leap years and month-length
changes. Overlap constraint rejects a second period. `ensure_budget_period` called concurrently
creates exactly one row. Closed periods reject writes but allow reads. Editing a plan mid-period
changes derived numbers and no transactions. `get_period_summary` excludes transfers and resolves
splits.

**Acceptance criteria**
- [ ] September and August budgets both exist and are independently correct
- [ ] Editing September never alters August
- [ ] A closed period cannot be edited but can be viewed
- [ ] A user paid on the 25th gets a 25th → 24th period
- [ ] Category usage matches the sum of that category's transactions, splits included, refunds netted

**Risks.** Rollover semantics are a product decision as much as a technical one. Decide the
sign policy (§4.1 of [FINANCIAL-ENGINE.md](./FINANCIAL-ENGINE.md)) before building, not during.

---

## Milestone 5 — Safe daily limit

**Scope.** The signature feature. `calculateSafeDailyLimit` with the `EvenSpreadStrategy`, the
breakdown, and every documented edge case. The dashboard hero widget with its explanation panel.

**Dependencies:** M4.

**Database.** None. *(This is the milestone that proves the schema was right.)*

**Domain.** `budget/calculateSafeDailyLimit`; `SafeDailyLimitStrategy`; `EvenSpreadStrategy`.

**Frontend.** `SafeDailyLimitWidget` — number, status colour, breakdown, and the four states. Zero
arithmetic in the component; it renders a `SafeDailyLimitResult`.

**Tests.** The entire §3.5 edge-case matrix. Property: `limit × daysRemaining + buffer = remaining`.
Explicit regression: **`does not divide by 30`**. Three `incomeBasis` policies. E2E: the number
changes correctly after adding an expense.

**Acceptance criteria**
- [ ] 100% branch coverage on the calculation
- [ ] Zero income shows "set up your budget", **not ₹0**
- [ ] Overspending shows the amount over, not a negative limit
- [ ] The limit changes when a transaction is added, and again the next day
- [ ] A user can see exactly why the number is what it is
- [ ] Grep proves no arithmetic on money in any `.tsx` file

**Risks.** The formula is a product decision. Ship the transparent version; measure whether users
trust it before making it clever.

---

## Milestone 6 — Savings goals

**Scope.** Goal CRUD, archiving, the contribution ledger, contribution and withdrawal, progress,
required rate, projected completion, goal history.

**Dependencies:** M2 (M4 for the "protect this month's contribution" hint).

**Database.** `goals`; `goal_contributions`; `sync_goal_saved()` trigger (`SECURITY DEFINER` — it
writes columns the caller cannot, see ADR-0020); `add_goal_contribution()` RPC;
`recompute_goal_totals()`; column grants excluding `saved_minor` and `achieved_at` from **both**
`INSERT` and `UPDATE` (ADR-0019).

`add_goal_contribution()` calls `award_xp()`, which exists from M1, so the RPC is transactionally
complete on first delivery. It does **not** call `evaluate_achievements()` — that function and the
achievement catalog arrive in M9, and the RPC gains the call then. This is the one place where the
"one transaction" guarantee is delivered in two steps, and it is recorded here rather than
discovered later.

**Domain.** `goals/calculateGoalProgress`, `calculateGoalPlan`, `projectGoalCompletion`.

**Tests.** Trigger keeps `saved_minor = sum(contributions)` after insert, update, and delete.
**20 concurrent contributions to one goal produce an exact total.** `saved_minor` is not writable
by its owner (`42501`). `add_goal_contribution` on another user's goal returns the same error as a
missing goal. Idempotency on `client_request_id`. Projection edge cases: one contribution, negative
rate, already achieved. `recompute_goal_totals` repairs deliberate corruption.

**Acceptance criteria**
- [ ] Goal progress cannot be set directly by any client request — on `INSERT` or on `UPDATE`
- [ ] The contribution list explains the total exactly
- [ ] Concurrent contributions never lose money
- [ ] Reaching the target sets `achieved_at`, once. *(The `goal_achieved` achievement unlocks in M9,
      when the catalog exists.)*
- [ ] A projection with insufficient data says so rather than inventing a date

**Risks.** None significant — this milestone is the cleanest application of the ledger principle.

---

## Milestone 7 — Dashboard

**Scope.** The widget registry and all MVP widgets: safe daily limit, budget status, balances,
month summary, spending breakdown, goals, recent transactions. Per-widget error boundaries.
`get_dashboard_snapshot` to collapse the request waterfall.

The registry also carries the `insights` and `streak` entries behind their feature flags
([PRODUCT.md §7](./PRODUCT.md)), both flags off. Those two **widgets** are built in M8 and M9
respectively; M7 proves the registry renders around a disabled entry without a gap.

**Dependencies:** M5, M6.

**Database.** `get_dashboard_snapshot()` RPC.

**Frontend.** `features/dashboard` with `DashboardGrid` + registry; `components/charts`
(`CategoryDonut`, `MonthlyBars`, `GoalProgressBar`).

**Tests.** Each widget's four states. A failing widget does not blank the dashboard. Mobile layout
at 360 px. `axe` clean. Snapshot response validated by Zod. E2E: full dashboard on a throttled
3G profile.

**Acceptance criteria**
- [ ] Every widget has loading, empty, error, and loaded states
- [ ] One widget's failure degrades to an inline error; the rest render
- [ ] First contentful paint under 2 s on simulated 3G, mid-range Android
- [ ] The dashboard is one round trip, not seven
- [ ] Adding or reordering a widget is a config change

**Risks.** The dashboard is where "just one small calculation here" creeps into components. The
boundary lint rule is the defence; keep it enabled.

---

## Milestone 8 — Analytics and insights (rules)

**Scope.** Analytics screen: spending by category, spending over time, income vs expenses, savings
rate, budget utilisation, month comparison, goal progress, trends. A rules-based `InsightProvider`
producing the first ten insights. Financial health score.

**Dependencies:** M7, plus at least two periods of data.

**Database.** `get_spending_over_time()`, `get_monthly_comparison()` RPCs. **No schema change.**

**Domain.** `analytics/**`; `insights/RuleBasedInsightProvider`; `health/calculateFinancialHealthScore`.

**Tests.** Zero-fill of gaps in time series. `income = 0` → savings rate `undefined`, never `NaN`.
Comparison against a zero previous period says "new", not "+∞%". Health-score component
renormalisation when one component has insufficient data. Insight thresholds.

**Acceptance criteria**
- [ ] Every chart is keyboard-accessible and has a table fallback for screen readers
- [ ] Insights never fabricate a number; insufficient history says so
- [ ] Adding an insight is one new rule, not a new screen
- [ ] `InsightProvider` is the only interface the widget knows

**Risks.** Insight quality is a product problem. Write ten and delete the six that are not useful,
rather than shipping thirty generic ones.

---

## Milestone 9 — Gamification

**Scope.** The gamification *product surfaces*: XP display, levels, streaks, ten achievements,
daily check-in, the XP history screen, opt-out. The tables and `award_xp()` have existed since M1;
nothing about them is user-visible until this milestone.

**Dependencies:** M7 (the widget registry the streak widget plugs into) and M6 (the goal
achievements). The schema dependency was satisfied in M1.

**Database.** The four tables and `award_xp()` already exist from M1. This milestone adds
`on_transaction_awards_xp()`, `evaluate_achievements()`, `recompute_xp_totals()`, the
`daily_check_in()` RPC, and the `achievements` catalog rows. Grants are unchanged — `SELECT`-only
on all four tables, set in M1.

**Domain.** `gamification/levels`, `streak`, `achievements/catalog`.

**Tests.** The full streak transition table including the `invalid` future-date case. XP is not
writable by any client. Replaying `daily_check_in` awards nothing. Daily caps enforced. Disabling
gamification stops awards **server-side**. An achievement unlocks once and only once.

**Acceptance criteria**
- [ ] No client-callable path can grant XP
- [ ] The streak survives a UTC/IST midnight boundary (the v1 regression)
- [ ] XP history explains every point the user has
- [ ] Opting out hides every surface and stops the awards
- [ ] Rewards weight outcomes over activity

**Risks.** Tone. Review the copy as product, not as engineering. No confetti over a balance.

---

## Milestone 10 — Hardening

**Scope.** Security review against the [SECURITY.md](./SECURITY.md) threat model. Performance pass:
`EXPLAIN ANALYZE` on every dashboard query against a 50,000-transaction fixture, index verification,
bundle-size budget, route-level code splitting. Accessibility audit and fixes. Error-handling audit
(every path maps to an `AppError`). Observability: Sentry release tracking, structured logging,
business events, performance monitoring. Load test with realistic data volumes. Optional TOTP MFA.

**Dependencies:** M9.

**Database.** Index tuning based on measurement — **not** speculation. Possibly a `period_rollups`
table if `get_period_summary` measures slow at scale.

**Tests.** The complete RLS matrix re-run and reviewed line by line. Load test. Lighthouse ≥ 90 on
mobile. Full `axe` sweep plus a manual screen-reader pass.

**Acceptance criteria**
- [ ] Every threat in the model has a mitigation with a test asserting it
- [ ] Dashboard p95 under 500 ms with 50,000 transactions
- [ ] Initial bundle under 200 KB gzipped; charts and analytics lazy-loaded
- [ ] Lighthouse accessibility 100 on the key routes
- [ ] No unhandled promise rejection anywhere in the app
- [ ] Sentry receives zero events containing an amount, an email, or a token (asserted by test)

**Risks.** This milestone gets cut under deadline pressure. It is the one that must not be.

---

## Milestone 11 — Android via Capacitor

**Scope.** Capacitor 7 wrapper. Native session storage via `@capacitor/preferences`. Hardware
back-button mapping to router history. Safe-area insets. Splash and icons. Offline strategy:
TanStack Query persisted cache (read) + a mutation outbox with idempotency keys (write). Play
Store listing, privacy policy, data-safety declaration. Signed release build. `release/x.y`
branching begins.

**Dependencies:** M10.

**Database.** None.

**Frontend.** `platform/` port interfaces with web and native implementations. No feature imports
Capacitor directly — the same rule that keeps `domain/` pure keeps features platform-agnostic.

**Tests.** E2E on an Android emulator for the critical journey. Offline: submit while offline →
queued → replayed once on reconnect (**not twice** — the `client_request_id` test). Back button
never exits the app from a nested route.

**Acceptance criteria**
- [ ] The web bundle runs unmodified in the WebView
- [ ] Hardware back navigates rather than closing the app
- [ ] Session survives app restart
- [ ] A transaction logged offline appears exactly once after reconnect
- [ ] Play Store data-safety declaration matches what the app actually collects
- [ ] No feature file imports `@capacitor/*`

**Risks.** WebView performance on low-end devices — measure on a real ₹10,000 phone, not an
emulator. Play Store review timelines are outside our control; submit early.

---

## Milestone 12 — Transaction ingestion (SMS and import)

**Gated.** Do not start until the Google Play permissions declaration for `RECEIVE_SMS` has an
**answer**. If it is refused, build CSV/statement import instead — the pipeline below is identical
from "Transaction candidate" onward, which is the entire point of designing it as a pipeline.

**Scope.** The ingestion pipeline:

```
Source adapter (SMS listener | CSV import | future bank sync)
   → Parser (per-bank format, on-device for SMS)
   → TransactionCandidate { amountMinor, occurredOn, merchantRaw, last4, bankCode, confidence }
   → Categorisation (the M3 pipeline, unchanged)
   → Duplicate detection (dedupe_hash + fuzzy window)
   → INSERT transactions (source, status = 'pending_review')
   → Review queue UI
   → User confirms / rejects / marks duplicate
   → status = 'confirmed'  → and only now does it affect any number
```

**Dependencies:** M11, plus the policy answer.

**Database.** No new tables. `transactions.source`, `status`, `dedupe_hash`, `external_ref`, and
`tx_review_queue_idx` already exist from M2 — **this is the milestone that tests whether the
extension points were real.** Adds `record_transaction_review()` RPC.

**Android.** A Capacitor plugin exposing a parsed-candidate stream. Hardened receiver:
`android:permission="android.permission.BROADCAST_SMS"`, sender allow-listing, runtime permission
requested at opt-in with a clear explanation. **Never log the body. Never store the body. Never
transmit the body.** Local queue encrypted (SQLCipher / `EncryptedSharedPreferences`).

**Tests.** Parser fixtures for 10+ real Indian bank/UPI formats (HDFC, ICICI, SBI, Axis, Paytm,
PhonePe, GPay) plus malformed, truncated, multi-part, and promotional messages that must **not**
parse. Duplicate detection: exact and fuzzy. A privacy test asserting no log line and no persisted
row contains the message body. Nothing reaches `confirmed` without an explicit user action.

**Acceptance criteria**
- [ ] The core web app works fully with the feature absent — no dependency in either direction
- [ ] No message body is logged, stored, or transmitted, ever
- [ ] Every ingested transaction requires explicit confirmation
- [ ] Duplicates are flagged, not silently dropped
- [ ] A malformed message is discarded without a crash and without a log
- [ ] The app is fully usable if the SMS permission is denied

**Risks.** **The highest-risk milestone in the plan.** Play policy may refuse it outright (R5).
Bank formats change without notice. Parser accuracy under ~90% makes the review queue a chore worse
than manual entry. Mitigation: measure accuracy on real fixtures before shipping; keep CSV import
as the ranked fallback; and India's Account Aggregator framework is the regulated long-term path.

---

## Milestone 13 — Intelligent insights

**Scope.** An `AiInsightProvider` implementing the M8 interface. Spending anomaly detection,
forecasting, goal forecasting, personalised recommendations, and optionally a conversational
assistant over the user's own aggregates.

**Dependencies:** M8, M10, and enough historical data to be worth it (≥ 3 periods per user).

**Database.** None expected. If a new table is needed, an assumption in M8 was wrong — record it.

**Backend.** An Edge Function holding the model API key. **The key never reaches the client.** Only
*aggregates* are sent, never raw transaction rows: category totals, period sums, trends. The prompt
is versioned and logged; the response is validated against the `Insight` schema before it renders.

**Tests.** The provider is swappable and the widget is unchanged (that is the acceptance test for
the whole extension-point design). Malformed model output is rejected rather than rendered. No
prompt contains a merchant name, a description, or an account identifier. Cost and rate limits
enforced per user.

**Acceptance criteria**
- [ ] The insights widget code is byte-identical to its M8 version
- [ ] No raw transaction leaves the database
- [ ] The model key is never in the client bundle
- [ ] Insights are labelled as generated, and a wrong one is reportable
- [ ] The feature degrades to the M8 rules provider if the model is unavailable

**Risks.** Cost per user. Hallucinated financial advice — constrain outputs to descriptions of the
user's own data and never generate a recommendation the rules engine could not justify. This is
the milestone most likely to be cut, and the architecture is fine if it is.

---

## Sequencing summary

```
M0 Foundation
 └─ M1 Auth + onboarding
     └─ M2 Accounts + transactions      ◄── everything downstream is arithmetic over this
         ├─ M3 Categories + categorisation
         │   └─ M4 Budget engine
         │       └─ M5 Safe daily limit
         ├─ M6 Goals + contribution ledger
         └───────┬───────────┘
                 └─ M7 Dashboard
                     ├─ M8 Analytics + rules insights
                     └─ M9 Gamification
                         └─ M10 Hardening
                             └─ M11 Android
                                 └─ M12 Ingestion (SMS | CSV)   ← policy-gated
                                     └─ M13 AI insights
```

M3/M6 and M8/M9 are the two genuine parallelisation points for a second developer.

**The MVP ships at M7.** M8–M13 are improvements to a working product, and each can be cut without
touching what came before. If that stops being true, the extension points were not real and we
should say so out loud rather than migrate a core table quietly.
