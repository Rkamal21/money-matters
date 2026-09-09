# Money Matters 2.0 — Testing Architecture

Status: **Proposed** · Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) · Date: 2026-09-07

---

## 1. What we are actually testing for

This is a financial application with no server tier. Two categories of failure are unacceptable and
everything else is negotiable:

1. **A number is wrong.** The user makes a decision based on it. Unit tests on the domain layer.
2. **A user reaches another user's money.** Integration tests against real RLS policies.

Everything else — a misaligned button, a slow chart — is a bug we can ship and fix. These two are
not. The pyramid below is shaped by that, not by convention.

```
        ╱╲          E2E (Playwright)              ~15 specs
       ╱  ╲         critical journeys + negative security paths
      ╱────╲
     ╱      ╲       Integration (Vitest + local Supabase)   ~120 tests
    ╱        ╲      RLS matrix, RPC atomicity, triggers, constraints, migrations
   ╱──────────╲
  ╱            ╲    Component (Vitest + RTL + MSW)          ~80 tests
 ╱              ╲   states, forms, accessibility, error rendering
╱────────────────╲
       UNIT        (Vitest)                      ~400 tests
   domain/** — money, periods, budget, goals, gamification, categorisation
   100% branch coverage. Fastest to write, catches the worst class of bug.
```

**Coverage gates** (CI-enforced, not aspirational). **This table is the only place they are
stated** — a blanket `src/domain/**` threshold, which an earlier draft of ARCHITECTURE.md asserted,
fails the day `domain/insights` ships as an interface with no branches to cover:

| Path | Branch coverage |
|---|---|
| `src/domain/money/**`, `src/domain/period/**` | **100%** |
| `src/domain/budget/**`, `goals/**`, `gamification/**`, `transactions/**` | **100%** |
| `src/data/**` (mappers, error mapping) | 90% |
| `src/features/**` | 60% — a floor, not a target; the interesting logic should not be here |
| `src/components/ui/**` | no gate; covered by a11y and E2E |

A high percentage on a component tree proves very little. A missing branch in `divideFloor` is a
wrong number on a dashboard.

---

## 2. Tooling

| Tool | Role | Why this one |
|---|---|---|
| **Vitest 3** | unit + integration runner | Same transform pipeline as Vite (no second build config to drift), fast watch mode, `vi.setSystemTime` for deterministic clocks, native ESM + TS |
| **@testing-library/react** | component tests | Queries by role and label, so a test that passes is evidence the component is reachable by a screen reader |
| **MSW** | HTTP interception | Component tests exercise real hooks and real error mapping without a database |
| **Playwright** | E2E | Auto-waiting (no `sleep`), mobile-viewport emulation, trace viewer for CI failures, runs against a real Supabase |
| **Supabase CLI** | local Postgres + Auth in Docker | Integration tests hit **real** RLS. A mocked policy tests nothing |
| **fast-check** | property tests | Money and date invariants are exactly what property testing is for |
| **axe-core** (via `@axe-core/playwright`) | accessibility | Automated checks catch roughly 40% of WCAG issues; the rest is the manual checklist in §7 |
| **pgTAP** *(optional)* | SQL-level assertions | Considered; the TypeScript integration suite covers the same ground with one language and one runner. Revisit if SQL logic grows |

---

## 3. Unit tests — the domain layer

Co-located: `calculateSafeDailyLimit.ts` sits beside `calculateSafeDailyLimit.test.ts`. Every input
is explicit; no mocks are needed, because pure functions have nothing to mock.

### 3.1 Money

- Table-driven arithmetic including negatives and zero
- Currency mismatch throws
- `parseAmount`: `"1,234.5"`, `"₹1,234"`, `"1234.567"`, `"1 234"`, `"-50"`, `""`, `"abc"`, `"1e5"`,
  Devanagari and full-width digits
- Formatting for `en-IN` (`₹1,23,456.00` — Indian grouping, not `123,456`), `en-US`, and a
  right-to-left locale
- **Properties:** `add`/`subtract` inverse; `allocate(m, w).sum() === m` for arbitrary weights;
  `parseAmount(format(m)) === m`; `divideFloor(m, n).quotient * n + remainder === m`
- Boundary: values near ±9 × 10^14; `Number.isSafeInteger` guard fires above it

### 3.2 Periods and dates

Every row of the [FINANCIAL-ENGINE.md §2.3](./FINANCIAL-ENGINE.md) table is a test. The suite runs
three times in CI under `TZ=Asia/Kolkata`, `TZ=UTC`, `TZ=America/Los_Angeles`. A date test that runs
only in the author's timezone is not a date test.

Named regression tests (each reproduces a v1 bug before asserting the fix):

- `today is the user's local date, not the UTC date` — 00:30 IST on 8 Sep is `2026-09-08`
- `daysBetween is 1 across a spring-forward day`
- `a 31-day period yields a different daily limit than a 30-day period`
- `February 2028 has 29 days`
- `startDay 28 produces a valid period in every month of a leap year`

### 3.3 Safe daily limit

Every case in [FINANCIAL-ENGINE.md §3.5](./FINANCIAL-ENGINE.md), plus:

- `does not divide by 30` — a 28-day period and a 31-day period with identical plans produce
  different limits (the direct v1 regression)
- zero income → `insufficient_data`, **not** ₹0
- negative available → `overspent`, `limit = 0`
- all three `incomeBasis` policies on the same fixture
- **property:** `limit × daysRemaining + buffer === remaining` for arbitrary inputs

### 3.4 Budget, goals, gamification, categorisation

- Budget: thresholds at exactly 0.749/0.75/0.999/1.0/1.001; `pace` against elapsed ratio; rollover
  in both directions; zero limit → `no_limit`, never a division by zero
- Goals: achieved, overdue, over-saved, single contribution (`too_few_points`), net-negative rate,
  empty history
- Gamification: the full streak transition table including the `invalid` future-date case; level
  boundaries at 0/99/100/101 XP; daily caps
- Categorisation: normalisation of real Indian merchant strings
  (`UPI/SWIGGY/423512/PAYTM`, `AMAZON PAY INDIA PRI`, `UBER   INDIA SYSTEMS`), rule precedence,
  user rule beating system rule, no-match returning `null` rather than guessing `Other`

---

## 4. Integration tests — Supabase, RLS, and RPCs

Run against a local Supabase (`supabase start`) seeded with two real users, A and B. These are the
tests that would have caught every one of v1's security holes.

### 4.1 The RLS isolation matrix

Generated from a table list, so **adding a table without adding it to the list fails the build** —
the failure mode that matters most is a new table that nobody wrote a policy for. Full expectation
table in [SECURITY.md §8.1](./SECURITY.md). Summary:

| Assertion | Expected |
|---|---|
| A selects B's row | 0 rows |
| A inserts with `user_id = B` | policy violation |
| A inserts referencing B's account / category / goal | `23503` (composite FK) |
| A updates B's row | 0 rows affected |
| A sets `user_id = B` on their own row | policy violation (`WITH CHECK`) |
| A deletes B's row | 0 rows affected |
| A updates `goals.saved_minor` on their own goal | `42501` |
| A **inserts** a goal naming `saved_minor` or `achieved_at` | `42501` — the insert-side half of the control (ADR-0019) |
| A inserts a goal naming only granted columns | succeeds; `saved_minor` is `0` from its `DEFAULT` |
| A **inserts** a category naming `is_system`, or a transaction naming `status` / `source` / `is_split` | `42501` |
| A updates `gamification_profiles.xp_total` | `42501` |
| A calls `add_goal_contribution` on B's goal | `goal_not_found` (identical to a missing goal) |
| `anon` touches anything | permission denied |
| Any table with RLS off, any view without `security_invoker`, any `FOR ALL` policy | build fails |

### 4.2 Constraints and triggers

| Test | Asserts |
|---|---|
| Insert `amount_minor = 0` / negative | `23514` |
| Insert `kind='transfer'` with a `category_id` | `23514` |
| Insert `kind='transfer'` with `counter_account_id = account_id` | `23514` |
| Insert `kind='expense'` with a `counter_account_id` | `23514` |
| Insert splits summing to less than the parent | deferred constraint fires at **commit** |
| Insert a split, then correct it in the same transaction | commits successfully (proves the deferral is real) |
| Two budget periods overlapping | `23P01` |
| `occurred_on` in 1990 / 2099 | rejected (`CHECK` / trigger respectively) |
| Delete an account with transactions | `23503` restrict |
| Delete a system category | trigger error |
| Contribution insert/update/delete | `goals.saved_minor === sum(contributions)` after each |
| Contribution reaching the target | `achieved_at` set; going back below | cleared |
| Signup | `profiles` + `gamification_profiles` + 12 categories exist, in one transaction |

### 4.3 RPC behaviour

| Test | Asserts |
|---|---|
| `add_goal_contribution` happy path | contribution + total + XP event + achievement + audit row, all present |
| Same call twice with one `client_request_id` | one contribution, one XP event, second call returns the first row |
| **Concurrent contributions** — 20 parallel calls to one goal | `saved_minor === sum(contributions)` exactly; no lost updates |
| `ensure_budget_period` called twice concurrently | exactly one period row |
| `daily_check_in` twice in a day | one XP event, streak unchanged |
| `daily_check_in` with `p_today` far in the future/past | rejected |
| `get_period_summary` with transfers present | transfers appear in neither income nor expense |
| `get_period_summary` with splits present | category totals come from splits, and sum to the parent |
| `recompute_goal_totals` after deliberate corruption (via `service_role`) | totals restored |

### 4.4 Migrations

- Apply every migration to an **empty** database, in order — must succeed with no errors
- `supabase gen types typescript` produces no diff against the committed file
- The category constants generated from `seed.sql` produce no diff against the committed
  TypeScript ([ARCHITECTURE.md §R.5](./ARCHITECTURE.md)) — same job, same failure mode
- The schema assertions in [SECURITY.md §8.2](./SECURITY.md) all pass
- A "seed and query" smoke test proving the whole schema is usable end to end

### 4.5 The RLS execution model

Four assertions that exist because this behaviour is silent when it breaks
([ADR-0020](./adr/0020-rls-execution-model.md)):

| Test | Asserts |
|---|---|
| Every `SECURITY DEFINER` function's owner has `rolbypassrls` | a schema query, run with the other §8.2 assertions |
| `sync_goal_saved()` and `enforce_split_total()` are `SECURITY DEFINER` | a plain trigger writing a protected column fails `42501` and rolls back the user's write |
| Contribution as user A, then `saved_minor = sum(contributions)` | the positive control — proves the definer trigger can actually read the ledger and write the cache |
| Revoke `BYPASSRLS` from the function owner in a scratch database, insert a contribution | the total goes **stale with no error**. This is the regression test for the failure mode, and it is the reason the assertion above exists |

---

## 5. Component tests

React Testing Library + MSW. What they check is *contractual*, not cosmetic:

- **Four states, always:** loading (skeleton), empty (with a call to action), error (with retry),
  loaded. A widget missing one fails review.
- **Forms:** validation messages appear, are associated via `aria-describedby`, focus moves to the
  first invalid field, submit disables during flight, a duplicate submit reuses the same
  `clientRequestId`.
- **Error rendering:** given a `PostgrestError` from MSW, the UI shows our `userMessage` and
  **never** the raw database text. A test asserts the raw string is absent from the DOM.
- **Money rendering:** `<Money>` outputs the formatted value plus a spoken `aria-label`.
- **Dashboard widgets** are tested individually; one failing widget must not blank the dashboard
  (each has its own error boundary — asserted).

Not tested at this level: styling, layout, chart pixels. Those are for the design review and E2E
screenshots.

---

## 6. End-to-end tests

Playwright, against a real local Supabase, at 390 × 844 (mobile) and 1280 × 800 (desktop).
Each spec creates its own user, so specs are independent and parallelisable.

### 6.1 The critical journey (one spec, the product's spine)

```
Sign up → confirm email (via the local mail catcher)
  → Onboarding: income, period start day, savings target, first account
  → Add a second account (Cash)
  → Add income  ₹60,000 to Bank
  → Create a budget: fixed ₹25,000, savings ₹10,000, Food limit ₹6,000
  → Add expense ₹450 "Swiggy dinner"      → category auto-suggests Food
  → Transfer ₹10,000 Bank → Savings
  → Dashboard asserts:
        balances updated on both accounts
        the transfer appears in NEITHER income NOR expenses
        month spend = ₹450 (not ₹10,450)
        safe daily limit is present, > 0, and is not income/30
  → Create goal "New Laptop" ₹50,000
  → Contribute ₹5,000 → progress 10%
  → XP increased; streak = 1
  → Reload the page: every number is identical (nothing lived only in memory)
```

### 6.2 Other journeys

- Edit a transaction; totals and budget usage update
- Delete a transaction; undo within the window restores it
- Split a transaction across two categories; both budgets update; the split sums to the parent
- Record a refund; net spend decreases; the refund is not counted as income
- Change the period start day; the current period boundaries move; `occurred_on` values do not
- Navigate to a previous month; historical budget and totals are intact and read-only
- Filter transactions; the URL updates; a browser reload restores the same filtered view;
  the back button returns to the unfiltered list
- Offline: submit a transaction with the network cut → queued, retried, saved once (not twice)

### 6.3 Negative and security journeys

| Spec | Expected |
|---|---|
| Signed in as A, navigate to `/goals/<B's goal id>` | "Not available" page. Not a 500, not B's goal |
| Signed in as A, navigate to `/transactions/<B's transaction id>/edit` | "Not available" |
| Sign out, press Back | No cached financial data rendered |
| Session expiry mid-session (token cleared) | Redirect to login, `returnTo` preserved, cache cleared |
| Submit a transaction form twice rapidly | One transaction created |
| Direct PostgREST call with A's token targeting B's rows (in-test `fetch`) | Empty result / error |

---

## 7. Accessibility testing

- `axe-core` runs in CI over dashboard, transactions, budget, goals, and the auth screens.
  A new violation fails the build.
- Keyboard-only E2E: complete the add-transaction flow using only Tab / Enter / Escape.
- Contrast: token pairs validated at ≥ 4.5:1 (text) and ≥ 3:1 (UI) by a unit test over the theme
  tokens — so a palette change that breaks contrast fails before review.
- Manual checklist per release (automation cannot cover these): screen-reader pass with NVDA or
  VoiceOver on the critical journey; `prefers-reduced-motion` honoured; 200% zoom; touch targets
  ≥ 44 × 44 px.

---

## 8. CI pipeline

```
PR opened
  ├─ typecheck            tsc --noEmit                                (~20s)
  ├─ lint                 eslint (incl. boundary + a11y + no-console) (~15s)
  ├─ unit                 vitest run --coverage  × 3 timezones        (~40s)
  ├─ build                vite build + bundle-size budget check       (~30s)
  ├─ db                   supabase start → migrations from zero
  │                       → schema assertions → integration + RLS     (~3m)
  ├─ e2e                  playwright (sharded ×3)                     (~4m)
  ├─ a11y                 axe over key routes                         (~1m)
  └─ security             npm audit --audit-level=high
                          bundle scan for service_role / stray keys   (~30s)

All green + 1 approval (2 for migrations, RLS, or domain/money) → squash merge to main
main → preview deploy → production
```

Total ≈ 6 minutes wall-clock with parallel jobs. Anything slower stops being run before pushing,
and a test suite that is not run is not a test suite.

**Flake policy:** a test that fails intermittently is quarantined within 24 hours and fixed or
deleted within a week. A tolerated flaky suite trains everyone to ignore red, which costs more than
the coverage it provides.

---

## 9. Test data

- **Factories, not fixtures:** `aTransaction({ amountMinor: 45000n })` with sensible defaults, so a
  test states only what it cares about and a schema change updates one factory.
- **Deterministic clock:** every test that touches time injects one. No test reads the wall clock.
- **Seeded RNG** for property tests, so a failure is reproducible from its seed.
- **No production data, ever**, in any environment or fixture.
- **Local Supabase is disposable:** `supabase db reset` between suites; no test depends on another
  test's leftovers.

---

## 10. Definition of "tested" for a pull request

From the [Definition of Done](./CONTRIBUTING.md):

- [ ] New domain function → unit tests including every documented edge case
- [ ] New table, policy, or RPC → integration test **and** a row in the RLS matrix
- [ ] New critical user flow → an E2E spec
- [ ] Money or date logic → at least one property test
- [ ] Bug fix → a failing test first, named after the bug
- [ ] New UI component → loading, empty, error, and loaded states asserted
- [ ] Coverage gates still pass
