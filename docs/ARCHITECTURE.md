# Money Matters 2.0 — Architecture

Status: **Proposed** · Phase: architecture planning (no implementation yet) · Date: 2026-09-07

This document is the hub. It states the shape of the system and points at the document that owns
each detail. Nothing is specified in two places.

| Doc | Owns |
|---|---|
| [PRODUCT.md](./PRODUCT.md) | Product vision, the core loop, MVP scope, users, dashboard composition |
| [DATABASE.md](./DATABASE.md) | ER diagram, full schema, money & date models, constraints, indexes, concurrency, migrations |
| [SECURITY.md](./SECURITY.md) | Auth architecture, RLS design, threat model, privacy, security testing |
| [FINANCIAL-ENGINE.md](./FINANCIAL-ENGINE.md) | Every money calculation: inputs, outputs, assumptions, edge cases |
| [API.md](./API.md) | Service contracts, repository interfaces, RPC signatures, the error model |
| [TESTING.md](./TESTING.md) | Unit / component / integration / RLS / E2E strategy and CI |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Git workflow, review rules, migration ownership, Definition of Done |
| [ROADMAP.md](./ROADMAP.md) | Milestones 0–13 with scope, dependencies, acceptance criteria, risks |
| [adr/](./adr/README.md) | 22 Architecture Decision Records |

---

## V1 Audit

The repository as found: React 19 + Vite 7 in plain JavaScript, ~2,000 lines across 17 source
files, four Supabase tables, a Capacitor 6 Android wrapper, and an unfinished native SMS receiver.
Two commits, one branch, no tests, no CI, no migrations directory.

**Retain**

| Item | Why |
|---|---|
| Product concept and the core loop | The idea is right; the implementation is not |
| Supabase + Postgres + RLS as the platform | Correct choice, wrongly configured — see [ADR-0003](./adr/0003-supabase-as-backend.md) |
| Capacitor for Android | Correct: one bundle, no second codebase |
| Design language — dark-first palette, Inter, the `₹` splash, `NavIcons.jsx` | Genuinely good. Carried forward as **design reference**, not as code |
| Merchant-rule concept (`merchantCategory.js`, `MerchantCategorizer.kt`) | The right idea in the wrong place; becomes a data-driven service ([DATABASE.md §6.10](./DATABASE.md)) |
| SMS parser regexes (`TransactionSmsAnalyzer.kt`) | Preserved in [ADR-0015](./adr/0015-sms-ingestion-policy-gated.md) as Milestone 12 reference material |

**Rewrite**

| Item | Problem |
|---|---|
| `App.jsx` (473 lines) | Routing, all state, and all financial arithmetic in one component. `safeDaily = floor((income − fixed − savings) / 30)` is computed inline at line 60 |
| The five hooks (`useExpenses`, `useGoals`, `useBudget`, `useProfile`, `useAuth`) | Each hand-rolls fetching, optimistic update, and revert against Supabase directly. Five inconsistent implementations of what TanStack Query does once |
| `constants.js` date helpers | `todayStr()` returns the **UTC** date; `isToday()` string-prefix-matches it against a `timestamptz`; `isThisMonth()` then uses *local* `getMonth()`. Three functions, two timezone models, one silent bug |
| `useProfile.addXpAndUpdateStreak` | Computes XP and streak on the client and writes them |
| `useGoals.depositToGoal` | Reads `goal.current` from React state, adds, writes back. Lost update under any concurrency |
| The entire schema | See below |
| `AuthScreen.jsx` | Works, but no reset flow, no confirmation handling, and `onAuth` is an unused prop |

**Delete**

| Item | Why |
|---|---|
| `supabase_schema.sql` | Superseded wholesale by [DATABASE.md](./DATABASE.md) |
| `updated_app.apk` (3.9 MB) and `dist/` | Build artefacts in the working tree |
| `android/app/src/main/kotlin/**` (SMS receiver, Room DB, DAO, categoriser) | Wired to nothing — no Capacitor bridge, and the DAO exposes no read method. Logs complete bank SMS bodies to Logcat and stores them unencrypted |
| `RECEIVE_SMS` from `AndroidManifest.xml` | A Google Play **restricted** permission declared for an unimplemented feature. Alone, it risks store rejection |
| `src/App.css` (569 lines) + `index.css` | Replaced by Tailwind v4 tokens |

**Security findings**

| # | Finding | Severity |
|---|---|---|
| V1-S1 | `profiles.xp`, `level`, `streak` client-writable. `update({xp: 999999})` works from the console | **Critical** |
| V1-S2 | `goals.current` client-writable. `update({current: target})` completes any goal | **Critical** |
| V1-S3 | RLS policies with **no `WITH CHECK`** on all four tables — `FOR ALL USING (auth.uid() = user_id)` on `expenses`, `goals` and `budgets`, and a separate `FOR UPDATE USING (auth.uid() = id)` on `profiles`. A user can insert rows owned by another user and can move their own rows out of their tenant | **Critical** |
| V1-S4 | No `CHECK (amount > 0)` on `expenses.amount`. A negative expense silently inflates every total | **High** |
| V1-S5 | Full bank SMS bodies written to Logcat and to an unencrypted Room database | **High** |
| V1-S6 | `SmsTransactionReceiver` is `exported="true"` with no sender validation — any app can inject fabricated transactions | **Medium** |
| V1-S7 | No FK `ON DELETE` behaviour to `auth.users`; deleting a user fails or orphans financial rows | **Medium** |
| V1-S8 | `handle_new_user` is `SECURITY DEFINER` without `SET search_path` | **Medium** |
| V1-S9 | No `DELETE` policy distinction and no audit trail — a deletion is unrecoverable and unexplainable | **Low** |

Good news: `.env` was never committed (`git log --all -- .env` is empty) and `.gitignore` covered
it from the first commit. The anon key is public by design and grants nothing beyond RLS — which is
exactly why V1-S1 to V1-S4 are critical rather than theoretical.

**Financial-calculation findings**

| # | Finding |
|---|---|
| V1-F1 | `safeDaily = max(0, floor((income − fixed − savings) / 30))` — divides by a constant 30 regardless of month length, ignores money already spent, ignores days remaining, and returns the same number on the 1st and the 30th |
| V1-F2 | Money is `DECIMAL(10,2)` returned as a string and passed through `Number()`. Every total is float arithmetic, and any amount above ₹99,999,999.99 is rejected |
| V1-F3 | `isToday()` compares a **UTC** date against a `timestamptz` prefix. For `Asia/Kolkata` users, "today" is wrong between 00:00 and 05:30 local — 23% of every day |
| V1-F4 | `isThisMonth()` uses local `getMonth()` on a UTC-parsed date, so it disagrees with `isToday()` at month boundaries |
| V1-F5 | No income, no accounts, no transfers. Moving ₹10,000 to savings is recorded as spending |
| V1-F6 | One budget row per user with `UNIQUE(user_id)` and no period. Editing September destroys August; there is no budget history |
| V1-F7 | `depositToGoal` clamps at the target (`Math.min(goal.target, ...)`), silently discarding a contribution's excess |
| V1-F8 | The expense list is capped at `.limit(100)` and totals are computed by reducing that array — so every total is wrong at transaction 101, with no error |
| V1-F9 | Level is stored *and* derived (`Math.floor(xp / XP_PER_LEVEL) + 1` in the component), so the column and the display can disagree |

**Technical debt**

No tests of any kind. No CI. No TypeScript. No router (tab state in `useState`, so the Android back
button closes the app). No migrations directory — the schema is one hand-run SQL file. No indexes
beyond primary keys. No error handling: every hook does `if (!error && data)` and silently does
nothing on failure. Raw `prompt()` used for goal creation. DOM read via `document.getElementById`
for deposit amounts. `AuthScreen` receives an unused `onAuth` prop. `.idea/` is committed.

**Conclusion:** the concept and the platform choice are sound; the schema and the trust model are
not. See [ADR-0001](./adr/0001-rebuild-rather-than-refactor.md) for why this is a rebuild.

---

## 0. Assumptions

These are **assumptions, not facts**. Each one, if wrong, changes the design. Challenge them before Milestone 0.

| # | Assumption | If wrong |
|---|---|---|
| A1 | One user = one person's finances. No households, no shared budgets. | Adds a `households` table and membership-based RLS — a significant change to every policy. |
| A2 | One currency per user (INR at launch). `currency_code` is carried on every money row but never mixed within a user. | Multi-currency needs FX rates, a rate table, and every aggregate becomes rate-dependent. |
| A3 | The budgeting period is monthly, anchored to a user-configurable start day (1–28) — salary cycles are not calendar months. | Weekly/fortnightly periods are already supported by the `daterange` model; only period generation changes. |
| A4 | No bank connectivity at MVP. All transactions are entered by hand. | See risk R5 — SMS is not a guaranteed path. |
| A5 | Web-first. Android is the *same* React bundle wrapped by Capacitor, not a separate native UI. | A native Android UI would require promoting the domain layer to a shared cross-platform artifact (KMP or a REST API). |
| A6 | Team of 2–5 developers, continuous deployment to web. | Larger teams justify `develop` + release trains sooner (see §N). |
| A7 | Scale: thousands of users; tens of thousands of transactions per user at the extreme. | Beyond that, per-period materialized aggregates replace on-the-fly sums. |
| A8 | ~~Refunds are recorded as `income` transactions.~~ **Overridden on review:** refunds are a distinct `kind` and **net against spend**. | See [ADR-0018](./adr/0018-refunds-net-against-spend.md). Treating a refund as income inflates both sides of the savings rate and leaves the returned amount consuming a category budget. |
| A9 | ~~"Expected income" for the safe daily limit is the *planned* figure from the budget, not the sum of actual income transactions.~~ **Superseded:** the basis is `greater` — `max(planned, actual)`. | See [ADR-0021](./adr/0021-safe-daily-limit-income-basis.md) and [FINANCIAL-ENGINE.md §3](./FINANCIAL-ENGINE.md) (input `policy.incomeBasis`, assumption S1). `planned` alone ignores a bonus until the user re-plans; `actual` alone reads ₹0 before payday. Both remain selectable and tested. |

---

## A. Architecture Overview

### A.1 The shape of the problem

Money Matters has an unusual constraint for a client-heavy app: **the numbers must be right, and the user must not be able to lie to the system about them.** That splits business logic into two categories that must be handled in two different places:

- **Calculations** — "what is my safe daily limit?", "how far along is this goal?", "what level am I?". These are pure functions of data the user already owns. They can run in the browser. They must be pure, deterministic, and exhaustively tested.
- **Invariants** — "goal progress equals the sum of its contributions", "XP is only awarded for real events", "a transaction amount is positive", "you cannot reference another user's category". These are *rules the client must not be trusted to enforce*. They belong in PostgreSQL, as constraints, triggers, and Row-Level Security.

v1 got this backwards: it computed in components and trusted the client to write derived state. The reboot's central rule is:

> **Calculations live in a pure TypeScript domain layer. Invariants live in the database. Neither is duplicated in the other.**

Where a value is both computed and stored (goal `saved_minor`), the ledger is the source of truth and a database trigger maintains the column; the client cannot write it at all.

### A.2 Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ PRESENTATION            React components, routes, design system │
│                         Knows: props, hooks, URL. Knows nothing │
│                         about Supabase or SQL.                  │
├─────────────────────────────────────────────────────────────────┤
│ APPLICATION             Feature hooks + services. Orchestrates: │
│                         validate → call repo → map errors →     │
│                         invalidate cache. No arithmetic.        │
├─────────────────────────────────────────────────────────────────┤
│ DOMAIN                  Pure TS. Money, periods, budget engine, │
│                         goals, gamification rules.              │
│                         ZERO imports from React or Supabase.    │
├─────────────────────────────────────────────────────────────────┤
│ DATA ACCESS             Repository interfaces + Supabase impls. │
│                         Row ⇄ domain-entity mapping.            │
│                         Postgres error → AppError mapping.      │
├─────────────────────────────────────────────────────────────────┤
│ INFRASTRUCTURE          Supabase (Postgres, Auth, RLS, Edge     │
│                         Functions, Storage), Capacitor, Sentry, │
│                         hosting.                                │
└─────────────────────────────────────────────────────────────────┘
```

Dependencies point **downward only**. `domain/` is a leaf: it imports nothing from the app. This is enforced mechanically, not by convention — see §F.4.

### A.3 Why there is no Node backend

The obvious question: with Supabase, where is "the backend"?

**Answer: PostgreSQL is the backend.** RLS policies are the authorization layer, `CHECK` constraints and triggers are the validation layer, and `SECURITY DEFINER` RPC functions are the transactional service layer. PostgREST exposes it over HTTP. Edge Functions cover the small set of operations that need a secret or a network call the client must not make.

Writing a Node/Express tier in front of Supabase for CRUD would add a second place for authorization bugs, a second deployment, and ~80ms of latency, while *duplicating* rules RLS already enforces. It earns its place only when we need server-held secrets or third-party calls — and Edge Functions cover that without a persistent server.

The escape hatch is the repository interface (§G.1): if we ever outgrow this, `SupabaseTransactionRepository` is replaced by `HttpTransactionRepository` and no feature code changes.

---

## B. Architecture Diagram

```
                                CLIENTS
   ┌────────────────────────────┐          ┌────────────────────────────┐
   │  Web (browser)             │          │  Android (Capacitor 7)     │
   │  React 19 + TS + Vite      │          │  WebView + same JS bundle  │
   │                            │          │  + native plugins (later)  │
   └────────────┬───────────────┘          └─────────────┬──────────────┘
                │                                        │
                └──────────────────┬─────────────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │      APPLICATION SHELL       │
                    │  Router · QueryClient        │
                    │  AuthProvider · ErrorBoundary│
                    └──────────────┬───────────────┘
                                   │
     ┌─────────────────────────────▼──────────────────────────────┐
     │                      FEATURES (vertical slices)             │
     │  auth │ onboarding │ transactions │ budgets │ goals │       │
     │  dashboard │ insights │ gamification │ settings            │
     │  each = components/ hooks/ schemas/ api/ (+ its own tests)  │
     └───────┬──────────────────────────────────┬─────────────────┘
             │ calls (pure)                     │ calls (I/O)
   ┌─────────▼──────────────┐        ┌──────────▼──────────────────┐
   │   DOMAIN  (pure TS)    │        │  REPOSITORIES (interfaces)  │
   │ ┌────────────────────┐ │        │  TransactionRepository      │
   │ │ money/  Money      │ │        │  BudgetRepository           │
   │ │ period/ BudgetPeriod│ │       │  GoalRepository             │
   │ │ budget/ safe limit │ │        │  CategoryRepository         │
   │ │ goals/  progress   │ │        │  GamificationRepository     │
   │ │ gamification/ XP   │ │        │  ProfileRepository          │
   │ │ categorize/ rules  │ │        └──────────┬──────────────────┘
   │ │ insights/ (iface)  │ │                   │
   │ └────────────────────┘ │        ┌──────────▼──────────────────┐
   │ no React, no network   │        │  SUPABASE ADAPTER           │
   └────────────────────────┘        │  supabase-js · row mapping  │
                                     │  PG error → AppError        │
                                     └──────────┬──────────────────┘
                                                │ HTTPS + JWT
        ════════════════════════════════════════╪════════════════════
                          TRUST BOUNDARY        │  (everything above
                                                │   is user-controlled)
        ════════════════════════════════════════╪════════════════════
                                                │
                    ┌───────────────────────────▼────────────────────┐
                    │                 SUPABASE                       │
                    │  ┌──────────┐  ┌───────────┐  ┌─────────────┐  │
                    │  │  GoTrue  │  │ PostgREST │  │    Edge     │  │
                    │  │  (auth)  │  │ (REST/RPC)│  │  Functions  │  │
                    │  └────┬─────┘  └─────┬─────┘  └──────┬──────┘  │
                    │       │              │               │         │
                    │  ┌────▼──────────────▼───────────────▼──────┐  │
                    │  │            PostgreSQL                    │  │
                    │  │  ┌────────────────────────────────────┐  │  │
                    │  │  │ ROW-LEVEL SECURITY  (deny by       │  │  │
                    │  │  │ default; user_id = auth.uid())     │  │  │
                    │  │  ├────────────────────────────────────┤  │  │
                    │  │  │ CHECK constraints · composite FKs  │  │  │
                    │  │  │ triggers (goal totals, XP, audit)  │  │  │
                    │  │  │ SECURITY DEFINER RPCs (atomic ops) │  │  │
                    │  │  ├────────────────────────────────────┤  │  │
                    │  │  │ tables · indexes · migrations      │  │  │
                    │  │  └────────────────────────────────────┘  │  │
                    │  └──────────────────────────────────────────┘  │
                    └────────────────────────────────────────────────┘

     FUTURE (designed for, not built):
     ┌───────────────────┐   ┌──────────────────┐   ┌──────────────────┐
     │ Android SMS       │──▶│ Edge Fn: ingest  │──▶│ transactions     │
     │ parser (native,   │   │ dedupe + verify  │   │ status='pending  │
     │ on-device only)   │   │                  │   │        _review'  │
     └───────────────────┘   └──────────────────┘   └──────────────────┘
     ┌───────────────────┐   ┌──────────────────┐
     │ Edge Fn: insights │──▶│ insights table   │  ← InsightProvider port
     │ (rules → later AI)│   │                  │
     └───────────────────┘   └──────────────────┘
```

---

## C. Technology Stack

Every choice below has a reason and a named alternative. Where the decision is genuinely close, that is said out loud.

### C.1 Core

| Choice | Version | Why | Alternative considered |
|---|---|---|---|
| **TypeScript** | 5.x, `strict: true` | Non-negotiable. This app's core type is money; v1 shipped a streak bug and a float-money model that types would have caught at the boundary. `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` on. | Plain JS (v1). Rejected — it already cost us two production bugs. |
| **React** | 19 | Team knows it; largest ecosystem; the domain layer is framework-agnostic so this is a low-stakes choice. | Svelte/Solid are leaner, but the domain-layer design makes framework swap cheap later, so optimizing for hiring and ecosystem wins now. |
| **Vite** | 7 | Already in use, fast, first-class TS, trivial static output for Capacitor's `webDir`. | Next.js — rejected: we have no server rendering need, SEO is irrelevant behind a login wall, and its server runtime conflicts with a static Capacitor bundle. |
| **React Router** | 7 (declarative) | We need **URL state** (filters, period, open modal) and a real history stack so the Android hardware back button works. v1's `useState('home')` tab switching breaks back-button behaviour on Android. | TanStack Router (better type-safe search params — a genuine advantage; see ADR-011 for why it's a close call). |

### C.2 Data & state

| Choice | Why | Alternative |
|---|---|---|
| **Supabase** (Postgres 15+, GoTrue auth, PostgREST, Edge Functions) | Gives us relational integrity, RLS-as-authorization, and managed auth without operating a server. RLS is the single most valuable feature here: it makes "user A cannot read user B's money" a database-enforced property rather than an application concern we might forget in one endpoint. | **Firebase/Firestore** — rejected: no SQL, no joins, no `CHECK` constraints, and security rules are far weaker than RLS for relational integrity. **Neon + custom API** — more control, but we'd hand-roll auth, authorization, and an API tier. **Self-hosted Postgres** — rejected on ops cost for a 2–5 person team. |
| **TanStack Query** v5 | Server state needs caching, deduplication, invalidation, retry, stale-while-revalidate, and optimistic updates. v1 hand-rolled a worse version of this in five hooks (`useExpenses`, `useGoals`, …), each with its own optimistic-update-and-revert logic. This is the one dependency that removes the most bespoke code. | `useEffect` + `useState` (v1). Rejected — that *is* the bug surface. SWR — smaller, but weaker mutation/optimistic-update story. |
| **No global state library at MVP** | See §J. Auth session and user preferences go in two thin contexts; everything else is server state (TanStack Query), URL state (search params), or local form state. Adding Zustand/Redux now would be state with nothing to hold. | Zustand if a genuine cross-route ephemeral store appears. Redux Toolkit — rejected: heavy ceremony for an app whose global state is one session object. |
| **Zod** | Schema-first validation shared between forms, repository input, and Edge Functions. One schema → TS type (`z.infer`) → runtime check → form resolver. Eliminates the drift between "what the form allows" and "what the API accepts". | Valibot (smaller bundle) — viable, but Zod's ecosystem integration (RHF resolver, Supabase codegen) is worth the kilobytes. Yup — weaker TS inference. |
| **React Hook Form** | Uncontrolled inputs, minimal re-renders, native Zod resolver, and good accessible-error wiring. | Controlled `useState` per field (v1) — verbose and re-renders the tree on every keystroke. |

### C.3 Money

| Choice | Why |
|---|---|
| **In-house `Money` value object over `bigint` minor units** | Money is our core domain type; owning ~150 lines of it is cheaper than reasoning about a dependency's rounding semantics. `bigint` is exact by construction — no `0.1 + 0.2` class of bug is representable. Operations: `add`, `subtract`, `multiplyByRatio`, `divideFloor`, `allocate`, `compare`, `isNegative`, `format`, `parseUserInput`. Currency is part of the type; mixing currencies throws. |
| Alternative: **dinero.js v2** | Excellent library, immutable, `bigint`-capable, handles allocation and multi-currency well. Reconsider at the point we add multi-currency (A2) or need proportional allocation across categories. Rejecting it now is a "no unnecessary dependencies" call, not a quality judgement. |
| Alternative: **decimal.js / big.js** | Arbitrary-precision decimals. More power than we need — we have exactly one currency with exactly two decimal places. `bigint` is simpler and faster. |
| **Never `number` for money.** | Enforced by lint: `Money` is a branded type, and the repository layer converts at the boundary. A raw `number` cannot be passed to a domain money function. |

### C.4 UI

| Choice | Why | Alternative |
|---|---|---|
| **Tailwind CSS v4** | Design tokens live in one `@theme` block; no CSS-file-per-component drift (v1 had `App.css` at 569 lines). Purged output is small, which matters for a WebView on a mid-range Android phone. | CSS Modules — fine, but token discipline is manual. Styled-components — runtime cost in a WebView. |
| **Radix UI primitives, vendored shadcn/ui-style** | Accessibility is an architectural requirement (§17), and Radix gives us focus traps, roving tabindex, `aria-*` wiring, and Escape/Enter semantics *correctly* for dialogs, selects, tabs, popovers. Hand-rolling accessible modals is where accessibility budgets die. Vendoring the component source (not `npm install`-ing a kit) means we own and can restyle every component. | Headless UI — smaller set. MUI/Chakra — large runtime, opinionated look that fights "trustworthy, not crypto-dashboard". |
| **Recharts** | Small, declarative, composable, sane a11y defaults, SVG output that scales on mobile. | Chart.js (canvas — invisible to screen readers without extra work), Visx/D3 (more power, more code than a category donut and a monthly bar chart need). |
| **lucide-react** | Consistent stroke icon set, tree-shakeable. Replaces v1's emoji-as-icons, which read poorly to screen readers and render inconsistently across Android versions. | — |

### C.5 Quality & platform

| Choice | Why |
|---|---|
| **Vitest 3** + **@testing-library/react** | Same transform pipeline as Vite, fast watch mode, `vi.setSystemTime` for deterministic date logic. |
| **Playwright** | Cross-browser E2E, robust auto-waiting, mobile-viewport emulation, trace viewer for CI failures. |
| **MSW** | Intercepts Supabase HTTP in component tests, so features are testable without a database. |
| **Capacitor 7** | Wraps the existing web build; the only real path to Android without a second codebase (A5). Native features (SMS, biometrics) become plugins behind a TS port interface. |
| **Sentry** | Error tracking with source maps and release tracking. Configured with aggressive scrubbing — see §K.8. |
| **ESLint 9 (flat) + Prettier** | Plus `eslint-plugin-boundaries` to enforce the layering (§F.4). |
| **GitHub Actions** | CI: typecheck → lint → unit → migration apply → RLS suite → E2E. |
| **Hosting: Vercel or Cloudflare Pages** | Static SPA + preview deployment per PR. Either works; **still undecided, and it needs no ADR** — the choice is reversible in an afternoon because the build output is a static bundle either way. Pick one in Milestone 0 and record it in the README. Preview deploys are the thing that matters — reviewers should click, not clone. |

### C.6 Dependencies deliberately **not** added at MVP

`redux`, `zustand`, `axios` (supabase-js has fetch), `moment`/`dayjs` (native `Intl` + `Temporal`-shaped helpers in `domain/period` cover our needs; revisit only if timezone math gets hairy), `lodash`, any component kit, any AI SDK, any state-machine library.

---

## D. Database Architecture — summary

Full schema, ER diagram, constraints, indexes, and concurrency: **[DATABASE.md](./DATABASE.md)**.
The shape in one page:

**Fifteen tables.** `profiles`, `accounts`, `categories`, `transactions`, `transaction_splits`,
`budget_periods`, `budget_category_limits`, `goals`, `goal_contributions`,
`gamification_profiles`, `gamification_events`, `achievements`, `user_achievements`,
`merchant_rules`, `audit_log`.

**Three views, no stored aggregates.** `account_entries` expands each transaction into signed legs
(a transfer produces two); `account_balances` sums them; `transaction_category_amounts` unifies
split and un-split rows so every analytics query has one shape. All are `security_invoker = true`,
so RLS still applies — a view without that flag is an RLS bypass.

**The eight decisions that shape everything else:**

1. **Money is `bigint` minor units** with a currency column. No float anywhere. ([ADR-0005](./adr/0005-money-as-bigint-minor-units.md))
2. **`occurred_on date` ≠ `created_at timestamptz`.** Civil dates and instants are different types and are never compared. ([ADR-0006](./adr/0006-occurred-on-date-not-timestamptz.md))
3. **`amount_minor > 0` always.** Direction lives in `kind`, never in a sign — which is what closes v1's negative-expense hole.
4. **A transfer is one row with two account references,** expanded into two legs by a view. ([ADR-0017](./adr/0017-single-row-transfers-with-entry-view.md))
5. **Composite foreign keys `(id, user_id)`** make referencing another user's row a storage-layer error. ([ADR-0009](./adr/0009-composite-foreign-keys.md))
6. **Enums for structure, tables for taxonomy.** `transaction_kind` is an enum; `categories` is a table.
7. **Budgets have periods**, non-overlapping by an `EXCLUDE USING gist` constraint, so "which period is today in?" has exactly one answer.
8. **The only denormalisation is `goals.saved_minor`**, recomputed (never incremented) by a trigger from an append-only ledger, with a documented repair function. ([ADR-0010](./adr/0010-goal-progress-trigger-maintained.md))

**Idempotency and concurrency are schema features**, not application care: `client_request_id`
unique per user on transactions and contributions; `dedupe_key` unique on gamification events;
`FOR UPDATE` locks in the contribution RPC; optimistic concurrency on `updated_at` for edits.

---

## E. Security Architecture — summary

Threat model, RLS design, privacy rules, and the test matrix: **[SECURITY.md](./SECURITY.md)**.

**The premise:** there is no application server, so the browser talks to PostgREST with the user's
own JWT. Anyone can copy their token and `curl` the endpoint. Therefore **the database is the only
trust boundary**, and TypeScript validation is a user-experience feature, not a control.

**The defence stack, in execution order:**

```
Zod schema (UX only)  →  GRANTs  →  RLS USING / WITH CHECK  →  composite FKs
                      →  CHECK constraints  →  triggers  →  SECURITY DEFINER RPCs
```

Everything from `GRANT`s down runs server-side. Deleting the Zod layer changes how the app feels,
not how safe it is.

**Non-negotiables:**

- RLS `ENABLE` **and** `FORCE` on every table; **four explicit policies**, never `FOR ALL`; every
  `INSERT`/`UPDATE` policy has a `WITH CHECK` (v1's policies had none — a user could insert rows
  owned by someone else).
- **Column-level grants** where RLS runs out: `goals.saved_minor`, `goals.achieved_at`, and
  `gamification_profiles.xp_total` have no `UPDATE` grant, so tampering fails with `42501` before
  RLS is consulted. This is four lines of DDL and it is the most important control in the system.
- `SECURITY DEFINER` functions always `SET search_path = ''`, always derive the caller from
  `auth.uid()`, and return **identical errors** for "not found" and "not yours".
- `service_role` never leaves CI secrets and Edge Function env. CI greps the built bundle for it.
- **Security assertions are tests.** The RLS matrix is generated from a table list, so adding a
  table without a policy fails the build — the failure mode that matters most.

---

## F. Frontend Architecture

### F.1 Folder structure

```
src/
├── app/                          # Composition root. Wires everything, owns nothing.
│   ├── App.tsx                   #   Providers: Query, Auth, Theme, ErrorBoundary
│   ├── router.tsx                #   Route table + lazy boundaries
│   ├── providers/
│   │   ├── AuthProvider.tsx
│   │   ├── QueryProvider.tsx
│   │   └── ThemeProvider.tsx
│   └── layouts/
│       ├── AppLayout.tsx         #   Authed shell: nav, header, outlet
│       └── AuthLayout.tsx
│
├── domain/                       # ★ PURE. No React. No network. No Date.now().
│   ├── money/
│   │   ├── Money.ts              #   bigint value object
│   │   ├── format.ts             #   Intl.NumberFormat wrappers
│   │   └── parse.ts              #   "1,234.50" → Money | ParseError
│   ├── period/
│   │   ├── LocalDate.ts          #   tz-safe civil date (no time component)
│   │   ├── BudgetPeriod.ts       #   resolveCurrentPeriod, daysRemaining, ...
│   │   └── Clock.ts              #   interface Clock { today(tz): LocalDate }
│   ├── budget/
│   │   ├── calculateBudgetUsage.ts
│   │   ├── calculateSafeDailyLimit.ts
│   │   └── budgetStatus.ts       #   ok | approaching | at_limit | exceeded
│   ├── transactions/
│   │   ├── calculateBalance.ts
│   │   ├── calculateMonthlySpending.ts
│   │   ├── aggregateByCategory.ts
│   │   └── categorize/
│   │       ├── CategoryRule.ts   #   interface — the extension point
│   │       └── keywordRules.ts   #   the MVP implementation
│   ├── goals/
│   │   ├── calculateGoalProgress.ts
│   │   ├── calculateRemainingGoalAmount.ts
│   │   └── calculateProjectedGoalDate.ts
│   ├── gamification/
│   │   ├── levels.ts             #   levelForXp / xpForLevel / progressToNext
│   │   ├── streak.ts             #   pure state transition
│   │   └── achievements/
│   │       ├── Achievement.ts    #   { code, predicate(snapshot): boolean }
│   │       └── catalog.ts
│   ├── insights/
│   │   └── InsightProvider.ts    # ★ interface only at MVP. No implementation.
│   ├── health/
│   │   └── calculateFinancialHealthScore.ts
│   └── errors/
│       └── DomainError.ts
│
├── data/                         # Data access. The only place that knows Supabase.
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── database.types.ts     #   generated: `supabase gen types typescript`
│   │   └── mapErrors.ts          #   PostgrestError → AppError
│   ├── repositories/             #   interface + Supabase impl per entity.
│   │   ├── TransactionRepository.ts        # interface
│   │   ├── SupabaseTransactionRepository.ts
│   │   ├── BudgetRepository.ts
│   │   ├── GoalRepository.ts
│   │   ├── CategoryRepository.ts
│   │   ├── AccountRepository.ts
│   │   ├── ProfileRepository.ts
│   │   ├── GamificationRepository.ts
│   │   ├── MerchantRuleRepository.ts
│   │   └── AnalyticsRepository.ts
│   └── mappers/                  #   Row ⇄ domain entity (bigint ↔ Money)
│
├── platform/                     # Capacitor/web port interfaces + implementations.
│                                 # No feature file imports @capacitor/* — see §M.1
│
├── features/                     # Vertical slices. A feature owns its UI + hooks + schemas.
│   ├── auth/
│   │   ├── components/  LoginForm.tsx  SignupForm.tsx  ResetPasswordForm.tsx
│   │   ├── hooks/       useSignIn.ts  useSignUp.ts  useSignOut.ts
│   │   ├── schemas/     auth.schema.ts
│   │   └── routes/      LoginPage.tsx  SignupPage.tsx
│   ├── onboarding/
│   ├── transactions/
│   │   ├── components/  TransactionForm  TransactionList  TransactionFilters
│   │   ├── hooks/       useTransactions  useCreateTransaction  useTransactionFilters
│   │   ├── schemas/     transaction.schema.ts
│   │   └── routes/      TransactionsPage.tsx
│   ├── budgets/
│   ├── goals/
│   ├── dashboard/
│   │   ├── widgets/     BalanceWidget  SafeDailyLimitWidget  BudgetStatusWidget
│   │   │                MonthSummaryWidget  RecentTransactionsWidget
│   │   │                SpendingBreakdownWidget  GoalsWidget
│   │   │                InsightsWidget (M8)  StreakWidget (M9)
│   │   └── DashboardGrid.tsx    #  widget registry → renders from config
│   ├── gamification/
│   ├── insights/
│   └── settings/
│
├── components/                   # Shared, feature-agnostic. If only one feature
│   ├── ui/                       # uses it, it lives in that feature instead.
│   │   Button Input Select Card Dialog Sheet Toast Tabs Badge Progress
│   │   Skeleton EmptyState ErrorState Money Amount DatePicker
│   └── charts/  CategoryDonut  MonthlyBars  GoalProgressBar
│
├── hooks/                        # Cross-cutting only: useMediaQuery, useDebounce,
│                                 # useLocalStorage, useReducedMotion
├── lib/                          # Framework glue: cn(), queryKeys, errorPresenter,
│                                 # analytics, logger
├── config/                       # env.ts (validated), constants, feature flags
├── types/                        # Shared ambient types only
└── styles/                       # theme.css (@theme tokens), globals.css

supabase/
├── migrations/                   # Timestamped, forward-only SQL. Never edited after merge.
├── functions/                    # Edge Functions (Deno). One at MVP: delete-account (M1),
│                                 # which needs service_role. Others are M12/M13.
└── seed.sql                      # Local dev seed data

tests/
├── integration/                  # Vitest against a local Supabase
├── rls/                          # ★ The cross-tenant isolation matrix
└── e2e/                          # Playwright
```

### F.2 Why this structure

- **`domain/` at the root, not inside a feature.** The safe-daily-limit calculation is used by `dashboard`, `budgets`, and later `insights`. Putting it under `features/budgets/` would make three features depend on one, which is how a "feature" folder quietly becomes a god-module. Domain is shared and depends on nothing.
- **Features own their vertical slice.** A developer working on goals touches `features/goals/`, `domain/goals/`, `data/repositories/GoalRepository*`, and one migration. That is the unit of parallel work (§N).
- **`components/` is for genuinely shared UI only.** The rule: a component moves from `features/x/components/` to `components/ui/` the *second* time a different feature needs it — not in anticipation. This is the guard against v1's "everything in one folder" outcome.
- **`data/` is a hard boundary.** `import { supabase }` appears in exactly one directory. Everything else talks to a repository interface.
- **`dashboard/widgets/` + a registry.** Each widget is self-contained (own query, own loading state, own empty state, own error boundary). `DashboardGrid` renders from a config array, so adding/removing/reordering widgets is a data change, not a restructure. This satisfies "the dashboard must be modular".

### F.3 Route map

```
/                        → redirect to /dashboard or /login
/login  /signup  /reset-password  /update-password       (AuthLayout, public)
/onboarding                                              (authed, gate)
/dashboard                                               (authed)
/transactions            ?q= &category= &from= &to= &direction= &account= &page=
/transactions/new        (modal route over /transactions)
/transactions/:id/edit   (modal route)
/budget                  ?period=2026-09
/goals   /goals/:id
/insights
/settings                /settings/profile  /categories  /accounts  /security
```

Filters and the active period live in the URL, not in React state. This gives shareable/bookmarkable views, correct browser + Android back-button behaviour, and survives a WebView reload.

### F.4 Enforcing the layering

Convention is not enforcement. `eslint-plugin-boundaries` (or `dependency-cruiser`) encodes the rules in CI:

```js
// eslint.config.js — sketch
boundaries: {
  elements: [
    { type: 'domain',     pattern: 'src/domain/*' },
    { type: 'data',       pattern: 'src/data/*' },
    { type: 'features',   pattern: 'src/features/*' },
    { type: 'components', pattern: 'src/components/*' },
    { type: 'app',        pattern: 'src/app/*' },
  ],
  rules: [
    { from: 'domain',     allow: ['domain'] },              // leaf
    { from: 'data',       allow: ['domain', 'data'] },
    { from: 'features',   allow: ['domain','data','components','hooks','lib'] },
    { from: 'components', allow: ['components','hooks','lib','domain'] },
  ],
}
```

Plus a hard ban that catches the highest-value mistakes:

```js
'no-restricted-imports': ['error', {
  patterns: [
    { group: ['react', 'react-*', '@supabase/*', '@tanstack/*'],
      message: 'domain/ must stay pure.',
      // scoped via an override applying only to src/domain/**
    },
    { group: ['**/data/supabase/client'],
      message: 'Use a repository interface, not the Supabase client.',
      // scoped to src/features/** and src/components/**
    },
  ],
}]
```

If a PR puts `(income - fixed) / 30` in a component, the reviewer catches it. If a PR imports `supabase` into a component, **CI** catches it. Automate the rule you cannot afford to forget.

### F.5 Design system

Tokens in one place, consumed everywhere. Tailwind v4's `@theme` makes this a single CSS block.

```css
@theme {
  /* Typography — one family, weight does the work. Tabular figures for money. */
  --font-sans: "Inter var", ui-sans-serif, system-ui, sans-serif;
  --font-numeric: "Inter var", ui-sans-serif;   /* + font-variant-numeric: tabular-nums */

  /* Type scale (1.200 minor third) */
  --text-xs: 0.75rem;  --text-sm: 0.875rem;  --text-base: 1rem;
  --text-lg: 1.125rem; --text-xl: 1.375rem;  --text-2xl: 1.75rem;
  --text-3xl: 2.25rem;                        /* the one big number on a screen */

  /* Spacing — 4px base, no arbitrary values in components */
  --spacing: 0.25rem;                          /* 1..16 → 4px..64px */

  /* Radius — soft, not pill. Trustworthy, not toy. */
  --radius-sm: 0.375rem; --radius-md: 0.5rem;
  --radius-lg: 0.75rem;  --radius-xl: 1rem;

  /* Elevation — two levels only. Depth is a hierarchy signal, not decoration. */
  --shadow-card: 0 1px 2px rgb(0 0 0 / .04), 0 1px 3px rgb(0 0 0 / .06);
  --shadow-overlay: 0 8px 24px rgb(0 0 0 / .12);

  /* Semantic colour — never used raw; components reference role tokens */
  --color-bg: ...; --color-surface: ...; --color-border: ...;
  --color-text: ...; --color-text-muted: ...;
  --color-brand: ...;                          /* one accent, used sparingly */
  --color-positive: ...;  /* income, under budget, goal met  */
  --color-caution: ...;   /* approaching a limit             */
  --color-negative: ...;  /* over budget, overspend          */
}
```

Rules that keep it from drifting into a "crypto dashboard":

1. **One accent colour.** Gradients only on the single hero number (safe daily limit), if at all.
2. **Money is always `tabular-nums`** so columns align and digits don't jitter as values update.
3. **Colour is never the only signal.** Over budget = red *and* an icon *and* text. Required for colour-blind users and for §17 contrast compliance.
4. **Motion is functional.** Transitions ≤ 200ms, and every one respects `prefers-reduced-motion` (a `useReducedMotion` hook plus a global media query).
5. **Four states per data component, always:** loading (skeleton matching final layout, not a spinner), empty (with the action that fills it), error (with a retry), loaded. `EmptyState` and `ErrorState` are shared components so no feature invents its own.
6. **Mobile-first.** Base styles target 360px. Breakpoints at `sm:640 md:768 lg:1024`. Bottom tab bar ≤ md, sidebar ≥ lg. Every interactive target ≥ 44×44px.

### F.6 Accessibility (architectural, not a cleanup task)

| Concern | How it's handled structurally |
|---|---|
| Keyboard | Radix primitives provide focus trap, roving tabindex, Escape-to-close for free. Route changes move focus to the `<h1>` via a `RouteAnnouncer`. |
| Screen readers | Semantic HTML enforced by `eslint-plugin-jsx-a11y` in CI. Money rendered by a `<Money>` component that outputs a visible formatted value plus an `aria-label` with the full spoken amount ("one thousand two hundred rupees" rather than "₹1,200"). |
| Labels | Every input goes through the shared `<Field>` component, which wires `<label htmlFor>`, `aria-describedby` for hints, and `aria-invalid` + `role="alert"` for errors. It is not possible to render an unlabelled input with our `Input`. |
| Focus | `:focus-visible` ring token in the theme; never `outline: none` without a replacement (lint rule). |
| Contrast | Token pairs validated at ≥ 4.5:1 (text) / 3:1 (UI) at design time; a Playwright + `axe-core` check runs on every key page in CI. |
| Reduced motion | Global `@media (prefers-reduced-motion: reduce)` disables transitions; chart animations gated on the `useReducedMotion` hook. |
| Forms | RHF + Zod produce an error summary at the top of the form, focus moves to the first invalid field on submit. |

CI runs `axe-core` against dashboard, transactions, budget, and goals. A new violation fails the build.

---

## G. Backend / Data Architecture

### G.1 Repositories

The interface is the contract features depend on. The Supabase class is an implementation detail.

**[API.md §3](./API.md) owns the repository signatures.** They are not restated here: an earlier
draft printed a second copy of `TransactionRepository` that drifted from the real one — different
delete method, and no optimistic-concurrency token on `update`. This document owns *why* the
indirection exists; API.md owns *what* the methods are.

Two rules make this worth the indirection:

1. **Aggregates are computed in Postgres, not in the browser.** `sumByCategory` is an RPC returning grouped sums — not `select *` followed by `Array.reduce`. v1 fetched 100 rows and reduced in `App.jsx`; that breaks silently at 101 transactions and burns mobile data. The domain layer receives *totals*, not row dumps.
2. **The repository is where `bigint` becomes `Money`.** A row leaves the repository as a domain entity. No feature ever sees `amount_minor: number`. This is the boundary that makes "never float arithmetic on money" structurally true rather than a guideline.

### G.2 Application services

Between hooks and repositories, for operations with more than one step:

```ts
// features/goals/services/contributeToGoal.ts
export async function contributeToGoal(
  input: unknown,
  deps: { goals: GoalRepository; clock: Clock },
): Promise<Result<GoalContribution, AppError>> {
  const parsed = contributionSchema.safeParse(input);       // 1. validate
  if (!parsed.success) return err(validationError(parsed.error));
  const amount = Money.fromMinor(parsed.data.amountMinor, parsed.data.currency);
  if (amount.isZeroOrNegative()) return err(...);           // 2. domain rule
  return deps.goals.addContribution({ ... });               // 3. one RPC = one txn
}
```

The service is pure orchestration and is unit-testable with fake repositories. Note step 3: the write is a **single RPC**, so contribution insert + goal total update + XP award + achievement check all happen in one Postgres transaction. Doing that as three client round-trips (v1's approach) leaves the database inconsistent whenever the network drops between calls.

### G.3 What runs where

| Operation | Where | Why |
|---|---|---|
| Read transactions, budgets, goals, categories | PostgREST direct | RLS enforces ownership; no server logic needed. |
| Create/update/delete a transaction | PostgREST direct | Constraints + RLS + composite FKs enforce every invariant. |
| Add a goal contribution | **RPC** `add_goal_contribution` | Atomic across contribution + goal total + XP + achievement. |
| Award XP / update streak | **Trigger + internal function only** | Client must never write XP. There is no client-callable XP path at all; `award_xp` is internal. |
| Period aggregates | **RPC** `get_period_summary` | Server-side aggregation, one round trip, no row dump. |
| Close/roll a budget period | **RPC** `ensure_budget_period` | Idempotent, avoids a race on first load of a new month. |
| Delete an account (the user's own) | **Edge Function** `delete-account` | Needs `service_role` to call `auth.admin.deleteUser`. Ships in M1, not "future". |
| *(future)* SMS transaction ingest | **Edge Function** | Needs dedupe logic + rate limiting + writes `status='pending_review'`. |
| *(future)* AI insights | **Edge Function** | Holds the model API key; must never reach the client. |

### G.4 Migrations

- Timestamped, forward-only SQL in `supabase/migrations/`.
- **A merged migration is immutable.** Fix forward with a new file. This is the rule that makes parallel feature branches safe (§N.5).
- Every migration must be idempotent-safe to *apply* (`create ... if not exists` where sensible) and must be applied by CI to a fresh database on every PR — a migration that doesn't apply cleanly from zero fails the build.
- Generated types (`supabase gen types typescript`) are committed and checked in CI; a schema change with stale types fails typecheck.

---

## H. Domain Architecture

`src/domain/` is the heart. Rules for everything in it:

1. **Pure.** No `fetch`, no Supabase, no React, no `localStorage`.
2. **No ambient time.** `Date.now()` and `new Date()` are banned by lint. Time enters as a `Clock` port or as an explicit `today: LocalDate` argument. This is what makes the safe-daily-limit and streak logic testable — and it is exactly the discipline v1 lacked when its streak comparison broke.
3. **No exceptions for expected failures.** Domain functions return discriminated results (`{ status: 'ok', value }` | `{ status: 'insufficient_data', missing: [...] }`). Exceptions are reserved for programmer errors (mixing currencies).
4. **Plain inputs, plain outputs.** Every function takes one input object and returns one result object, so adding a field never breaks a call site.
5. **Every function has a test file next to it.** [TESTING.md §1](./TESTING.md) owns the coverage gates and is the only place they are stated — they are tiered per directory, not a blanket `src/domain/**` threshold, because a module that is an interface with no branches (`domain/insights` at MVP) cannot satisfy one.

### Modules

| Module | Responsibility | Extension point |
|---|---|---|
| `money` | Exact arithmetic, formatting, parsing user input | Multi-currency (A2) |
| `period` | Timezone-correct civil dates; resolve the budget period from `budget_period_start_day` | Weekly/fortnightly periods |
| `budget` | Usage %, status thresholds, **safe daily limit** | Smarter limit strategies behind one interface |
| `transactions` | Balance, period spend, category aggregation, rule-based categorization | `CategoryRule` interface → ML classifier later |
| `goals` | Progress, remaining, projected completion date, required contribution rate | Goal prioritisation, auto-allocate |
| `gamification` | XP→level curve, streak transitions, achievement predicates | New achievements are catalog entries, not code changes |
| `health` | Financial health score from a weighted component set | Component weights become config |
| `insights` | **Interface only at MVP** — `InsightProvider.generate(snapshot): Insight[]` | Rules engine → then AI, both behind the same port |

The `insights` port is the whole of §5 (Future Intelligence) for now, and that is deliberate. One file, ~20 lines, no implementation:

```ts
export interface FinancialSnapshot { /* period, totals, budgets, goals, history */ }
export interface Insight {
  id: string;
  severity: 'info' | 'caution' | 'positive';
  title: string;
  body: string;
  action?: { label: string; route: string };
}
export interface InsightProvider {
  generate(snapshot: FinancialSnapshot): Promise<Insight[]>;
}
```

A rules-based provider ships in Milestone 8. An AI provider in Milestone 13 implements the same interface, and the dashboard widget never changes.

**Extension point for the safe daily limit.** The requirement says the calculation must be able to get smarter without a frontend rewrite. That means the *strategy* is swappable:

```ts
export interface SafeDailyLimitStrategy {
  readonly id: string;
  calculate(input: SafeDailyLimitInput): SafeDailyLimitResult;
}
// MVP: EvenSpreadStrategy. Later: WeekendWeightedStrategy, ForecastAwareStrategy.
```

The dashboard widget consumes `SafeDailyLimitResult`, which carries `{ limit, status, breakdown[], explanation }`. Because the breakdown is data, the UI can explain *why* the number is what it is without knowing how it was derived.

---

## I. API / Service Contracts

### I.1 Repository interfaces (summary)

| Repository | Operations |
|---|---|
| `ProfileRepository` | `get`, `update`, `completeOnboarding` |
| `AccountRepository` | `list`, `create`, `update`, `archive` |
| `CategoryRepository` | `list`, `create`, `update`, `archive`, `reorder` |
| `TransactionRepository` | `list`, `getById`, `create`, `update`, `softDelete`, `sumByCategory`, `sumForPeriod` |
| `BudgetRepository` | `getCurrent`, `ensurePeriod`, `upsertPlan`, `setCategoryLimit`, `removeCategoryLimit`, `getUsage` |
| `GoalRepository` | `list`, `getById`, `create`, `update`, `archive`, `addContribution`, `listContributions` |
| `GamificationRepository` | `getProfile`, `listAchievements`, `listUnlocked`, `checkIn` |
| `MerchantRuleRepository` | `list`, `create`, `update`, `remove` |
| `AnalyticsRepository` | `periodSummary`, `spendingOverTime`, `monthlyComparison`, `categoryTrends` |

Full signatures — including the `expectedUpdatedAt` optimistic-concurrency token on every
`update` — are in [API.md §3](./API.md), which owns them.

### I.2 Postgres RPCs (the server "API")

**[API.md §4](./API.md) owns the RPC contracts** — names, parameters, return types, error codes and
idempotency guarantees. They are deliberately not restated here. An earlier draft of this section
carried a second copy that had drifted badly: three signatures differed from the real ones, one
return type named `budgets` (a table that exists only in v1's schema), `add_goal_contribution` had
lost its `p_client_request_id` idempotency key, `get_dashboard_snapshot` was missing entirely, and
it listed a `record_gamification_event(p_type, p_dedupe_key)` endpoint that **does not exist and
must not** — a client able to pass its own event type and dedupe key could mint XP for events that
never happened. XP is written only by `award_xp`, which is internal and carries no grant
([ADR-0016](./adr/0016-gamification-server-authoritative.md)).

The properties that belong to *this* document rather than to API.md: every RPC is
`SECURITY DEFINER` with `SET search_path = ''` and fully-qualified names; every client-callable one
re-derives `auth.uid()` internally rather than trusting a passed-in user id; and the two internal
functions that do take a user id are never granted to `authenticated`
([SECURITY.md §4.5](./SECURITY.md) rule 2, asserted in §8.2).

### I.3 Error model

```ts
export type ErrorKind =
  | 'validation' | 'authentication' | 'authorization' | 'not_found'
  | 'conflict'   | 'rate_limited'   | 'data_access'   | 'network' | 'unexpected';

export interface AppError {
  kind: ErrorKind;
  code: string;              // stable, machine-readable: 'transaction.amount_positive'
  userMessage: string;       // safe to render. Never from the database.
  fieldErrors?: Record<string, string[]>;
  correlationId: string;     // logged; shown in the UI for support
  cause?: unknown;           // logged only, never rendered
  retryable: boolean;
}
```

**Mapping, in `data/supabase/mapErrors.ts` — the one place raw errors are touched:**

| Source | → | Kind |
|---|---|---|
| Zod `SafeParseError` | | `validation` (+ `fieldErrors`) |
| PG `23505` unique violation | | `conflict` |
| PG `23514` check violation | | `validation` |
| PG `23503` FK violation | | `validation` |
| PG `42501` / PostgREST `PGRST301` | | `authorization` |
| PostgREST `PGRST116` (no rows) | | `not_found` |
| GoTrue `invalid_credentials` | | `authentication` |
| `fetch` rejection / offline | | `network` (retryable) |
| anything else | | `unexpected` |

**Presentation, in `lib/errorPresenter.ts`:**

| Kind | UI |
|---|---|
| `validation` | Inline field errors, focus first invalid |
| `authentication` | Redirect to `/login`, preserve `returnTo` |
| `authorization` | Full-page "not available" — never reveal whether the record exists |
| `not_found` | Empty state with a route back |
| `conflict` | Toast with "refresh and retry" |
| `network` | Toast + automatic retry (TanStack Query backoff) |
| `unexpected` | Error boundary + Sentry report + correlation id shown |

**The rule that matters:** a `PostgrestError.message` never reaches a rendered string. Database messages leak schema (`column "x" of relation "budgets"`) and constraint names. `userMessage` is written by us, in English the user understands, per `code`.

### I.4 Data flows

**Add expense**

```
User submits TransactionForm
  → RHF + Zod validate (client, fast feedback)
  → useCreateTransaction (TanStack Query mutation)
      → optimistic cache insert           [UI updates instantly]
      → createTransaction service
          → parse to domain types (Money, LocalDate)
          → SupabaseTransactionRepository.create()
              → POST /rest/v1/transactions
                  → RLS: user_id = auth.uid()        ─┐
                  → CHECK amount_minor > 0            │  all enforced in
                  → composite FK (category_id,user_id)│  one transaction
                  → trigger: audit_log row            │
                  → trigger: gamification event +XP  ─┘
              ← row
          ← Transaction (domain entity)
      → onSuccess: invalidate ['transactions'], ['period-summary'],
                   ['budget-usage'], ['gamification']
      → onError:   rollback optimistic insert, map to AppError, present
  → Dashboard widgets refetch: safe daily limit, budget status, breakdown, XP
```

Note the split: Zod validates for *UX*; the database constraints validate for *truth*. The same rule exists twice on purpose in two different forms (a schema and a constraint) — that is not duplicated business logic, it is defence in depth at a trust boundary.

**Calculate safe daily limit**

```
Dashboard mounts
  → useSafeDailyLimit()
      → useQuery ['profile']          → timezone, budget_period_start_day, currency
      → useQuery ['budget','current'] → expected income, planned fixed, planned savings
      → useQuery ['period-summary']   → RPC: variable spent, fixed paid  (server aggregated)
      ↓ all resolved
      → domain/period.resolveCurrentPeriod({ today: clock.today(tz), startDay })
      → domain/budget.calculateSafeDailyLimit({ period, today, plan, actuals, policy })
          └─ the algorithm is FINANCIAL-ENGINE.md §3.2 — thirteen steps, not restated here
      ← { limit, status, daysRemaining, remaining, buffer, breakdown[], explanation }
  → SafeDailyLimitWidget renders the number, the status colour, and the breakdown
```

Zero arithmetic in the component. The widget renders a `SafeDailyLimitResult`.

**The formula lives in exactly one place.** An earlier draft of this diagram inlined a four-line
version of the calculation that had already drifted from
[FINANCIAL-ENGINE.md §3.2](./FINANCIAL-ENGINE.md): it dropped `rolloverIn`, dropped the
`overallLimit` clamp, dropped refund netting, and computed `daysRemaining` from an inclusive period
end when the only `BudgetPeriod` type in the system carries `endExclusive` — an off-by-one on the
product's hero number. Duplicating a money calculation in prose is the same mistake
[ADR-0007](./adr/0007-calculations-in-ts-invariants-in-postgres.md) forbids in code.

**Savings goal contribution**

```
User submits ContributionForm
  → Zod validate
  → useAddContribution mutation → optimistic goal.saved += amount
      → contributeToGoal service
          → GoalRepository.addContribution()
              → RPC add_goal_contribution()   ── single Postgres transaction ──┐
                  1. assert goal.user_id = auth.uid(), lock it FOR UPDATE      │
                  2. insert goal_contributions (amount validated per API §4)   │
                  3. update goals.saved_minor = sum(contributions)             │
                  4. if saved >= target → achieved_at = now(), else NULL       │
                  5. award_xp(...) → gamification_events + xp_total (dedupe)   │
                  6. evaluate + unlock achievements                            │
                  7. insert audit_log                                          │
              ←──────────────────────────────────────────────────────────────┘
      → invalidate ['goals'], ['gamification'], ['achievements']
  → GoalCard re-renders; if a level or achievement changed, a toast fires
```

Steps 2–7 are atomic. In v1 the equivalent was three independent client calls, any of which could fail alone. Note there is **no `goals.status` write**: status is derived from `archived_at` and `saved_minor >= target_minor` (§R.1, [DATABASE.md §6.8](./DATABASE.md)).

---

## J. State Management Strategy

Four kinds of state, four homes. The discipline is deciding which is which *before* reaching for a library.

| Kind | Examples | Home | Why |
|---|---|---|---|
| **Server state** | transactions, budgets, goals, categories, profile, XP | **TanStack Query** | It's a cache of remote data, not app state. Needs staleness, dedupe, retry, invalidation, optimistic updates — all of which we would otherwise hand-roll (badly, as v1 did five times). |
| **URL state** | filters, search text, date range, selected period, open modal, pagination | **`useSearchParams`** behind a typed `useTransactionFilters()` hook | Shareable, bookmarkable, survives reload, and gives the Android back button correct behaviour. Putting a filter in `useState` makes the back button close the app. |
| **Local UI state** | form fields, dropdown open, hovered row | **`useState` / RHF**, inside the component | Never leaves the component. |
| **Global client state** | session, theme, currency/locale prefs | **Two React contexts** (`AuthProvider`, `PreferencesProvider`) | Genuinely global, small, and changes rarely — the exact profile React Context handles well without extra re-render cost. |

### Do we need Zustand / Redux Toolkit?

**No, not at MVP.** Once server state is in TanStack Query and filter state is in the URL, the remaining global state is: the auth session (one object), the theme (one string), and preferences (three fields). Redux Toolkit for that is ceremony with no payoff; Zustand is 1KB with nothing to hold.

**When to revisit:** if we build a multi-step flow whose draft must survive route changes (a guided budget wizard, or an SMS-transaction review queue), a small Zustand store becomes the right tool. That is a Milestone 12 question. Adding it then costs an afternoon; adding it now costs every developer a decision on every piece of state for a year.

### Query key convention

```ts
export const queryKeys = {
  profile:        ()                 => ['profile'] as const,
  transactions:   (f: Filter)        => ['transactions', f] as const,
  periodSummary:  (p: PeriodKey)     => ['period-summary', p] as const,
  budget:         (p: PeriodKey)     => ['budget', p] as const,
  budgetUsage:    (p: PeriodKey)     => ['budget-usage', p] as const,
  goals:          ()                 => ['goals'] as const,
  goal:           (id: GoalId)       => ['goals', id] as const,
  gamification:   ()                 => ['gamification'] as const,
};
```

Centralised so invalidation is greppable. A mutation that affects the period summary invalidates `['period-summary']` — and it is obvious from one file which mutations should.

Defaults: `staleTime: 30s`, `gcTime: 5min`, `retry: 2` with exponential backoff, `refetchOnWindowFocus: true` on web / `false` in the Capacitor shell (a WebView regains focus constantly).

---

## K. Observability

Four channels, each with a rule about what must never be in it.

| Channel | Tool | Carries | Never carries |
|---|---|---|---|
| **Error tracking** | Sentry (browser + Capacitor) | `AppError.kind`, `code`, `correlationId`, route, release, stack | amounts, merchants, descriptions, emails, tokens, SMS content |
| **Structured logging** | a thin `lib/logger` over `console` in dev, Sentry breadcrumbs in prod | event name, route, duration, outcome | any financial value or PII |
| **Performance** | Sentry Performance + `web-vitals` | LCP, INP, CLS, route transitions, RPC durations | request bodies |
| **Business events** | a typed analytics client (self-hosted or none at MVP) | `transaction_created { kind, source, has_category }` | **any** amount, merchant, or free text |

**Scrubbing is code, not policy.** Sentry's `beforeSend` runs an **allow-list** over event data —
unknown keys are dropped rather than known-bad keys removed, because a deny-list fails silently the
first time someone adds a field. A unit test feeds a payload containing `amount_minor`, `email`, and
`access_token` through the hook and asserts all three are gone.

**The v1 anti-pattern this exists to prevent:**
`Log.i(TAG, "Transaction SMS | amount=$amount | … | message=$body")` — a complete bank SMS, with
balances and account fragments, in Logcat. Never log a message body, at any level, for any reason.
`console.log` is lint-banned in `src/`.

**Correlation.** Every `AppError` carries a `correlationId` generated at the point of failure. It is
attached to the Sentry event and shown in the UI ("reference c-8f3a…"), so a user report maps to a
specific event without asking them what they were doing.

**What we deliberately do not build at MVP:** a metrics pipeline, custom dashboards, log
aggregation, alerting beyond Sentry's defaults. With no server there is nothing to page anyone
about; Supabase's own dashboard covers database health.

---

## L. Performance

**Measure, then optimise.** The numbers below are budgets to verify in Milestone 10, not
speculative work for Milestone 2.

**Budgets**

| Metric | Target | Where |
|---|---|---|
| Initial JS bundle | < 200 KB gzipped | CI size check, fails the build |
| First contentful paint | < 1.5 s on simulated 3G, mid-range Android | Lighthouse in CI |
| Dashboard p95 | < 500 ms with 50,000 transactions | load test fixture |
| Transaction list page | < 200 ms | keyset pagination, 50 rows |
| Time to log an expense | < 10 s, one-handed | manual, every release |

**The five things that actually matter here**

1. **Aggregate in Postgres, never in the browser.** `get_period_summary` returns totals; the client
   never reduces a row dump. This is the single biggest difference from v1, which fetched 100 rows
   and summed them in `App.jsx` — wrong at row 101 and increasingly expensive on mobile data.
2. **One round trip for the dashboard.** `get_dashboard_snapshot` collapses a seven-request
   waterfall into one, which is worth more on a 3G connection than any amount of client tuning.
3. **Keyset pagination, never `OFFSET`.** `WHERE (occurred_on, id) < ($1, $2) ORDER BY … LIMIT 50`
   stays O(log n) at any depth and does not skip or repeat rows while new ones are being inserted.
4. **Indexes matched to actual query shapes** — the eight in [DATABASE.md §6.4](./DATABASE.md),
   including two partial indexes for the two branches of `account_entries`, and
   `(select auth.uid())` in policies so RLS evaluates once per query rather than once per row.
5. **Route-level code splitting.** Charts (Recharts) and the analytics screen load lazily; a user
   who never opens Analytics never downloads it.

**Caching.** TanStack Query with `staleTime: 30s` covers navigation within a session.
`refetchOnWindowFocus` is off in the Capacitor shell — a WebView regains focus constantly and would
refetch on every keyboard dismissal.

**The scaling path, when A7 breaks.** `get_period_summary` becomes a read of a `period_rollups`
table maintained by trigger or nightly job. Because clients already call an RPC rather than
aggregating rows, that change is invisible above the data layer. That is the whole reason the
aggregate is an RPC today.

**Not doing now, deliberately:** materialised views, a read replica, Redis, virtualised lists,
server-side rendering, or bundle micro-optimisation. Each is a real tool for a problem we have not
measured.

---

## M. Mobile, and the two future extensions

### M.1 Android strategy

Capacitor 7 wrapping the same web bundle. **Not** a second UI, and not React Native — the domain
layer is shared because it is literally the same code, and the alternative is maintaining two
implementations of every financial calculation.

| Concern | Approach |
|---|---|
| **Session** | `@capacitor/preferences`-backed storage adapter, not WebView `localStorage` — survives WebView data clearing, inside the app sandbox |
| **Hardware back** | Mapped to router history. v1's `useState` tab switching meant Back closed the app from any screen |
| **Safe areas** | `env(safe-area-inset-*)` in the layout shell |
| **Native access** | Behind `platform/` port interfaces with web and native implementations. **No feature file imports `@capacitor/*`** — the same rule that keeps `domain/` pure |
| **Performance** | Tested on a real low-end device, not an emulator. Tailwind's purged CSS and a small bundle matter more in a WebView than on desktop |

### M.2 Offline strategy — deliberately partial

**Not offline-first.** Full offline-first means conflict resolution on financial records, which is a
large amount of hard, high-stakes work for a use case (editing the same transaction on two devices
while both are offline) that is rare in a single-user app.

What we do build, in Milestone 11:

- **Reads:** TanStack Query's persisted cache. Opening the app on a train shows the last known
  dashboard, clearly marked as of a timestamp.
- **Writes:** a mutation outbox. A submitted transaction is queued with its `client_request_id`,
  retried on reconnect, and — because that id is unique per user — **replayed safely**. A duplicate
  submit returns the existing row.
- **Conflicts:** avoided rather than resolved. Creates are idempotent; edits use optimistic
  concurrency on `updated_at` and surface "this changed elsewhere" rather than silently merging.

Because writes already go through repositories, the outbox slots in beneath them without touching a
single feature.

### M.3 Future SMS ingestion — the extension architecture

**Not built at MVP.** Gated on a Google Play policy answer ([ADR-0015](./adr/0015-sms-ingestion-policy-gated.md), risk R5).

```
Source adapter        SMS listener │ CSV import │ future bank sync
      ▼
Parser                per-bank format, ON DEVICE. Body discarded on return.
      ▼
TransactionCandidate  { amountMinor, occurredOn, merchantRaw, last4, bankCode, confidence }
      ▼
Categorisation        the SAME pipeline as manual entry (§H)
      ▼
Duplicate detection   dedupe_hash unique index + fuzzy window
      ▼
transactions          source='sms', status='pending_review'   ← affects NO number yet
      ▼
Review queue UI       user confirms │ rejects │ marks duplicate
      ▼
status='confirmed'    only now does it count
```

**What makes this an extension rather than a rewrite:** `transactions.source`, `status`,
`dedupe_hash`, and `external_ref` and the review-queue index all exist from Milestone 2. Milestone 12
adds a source adapter and one RPC. If it adds a migration to a core table, an assumption was wrong
and we say so — that is the test of whether the extension point was real.

**Binding privacy constraints** ([SECURITY.md §9](./SECURITY.md)): never log the body, never persist
the body, never transmit the body, encrypt the local queue, require `BROADCAST_SMS` on the receiver,
allow-list senders, never auto-confirm a parse. The core web app has **no dependency** on any of
this in either direction.

### M.4 Future AI insights — the extension point

**One interface, no machinery:**

```ts
interface InsightProvider { generate(snapshot: FinancialSnapshot): Promise<Insight[]> }
```

Milestone 8 ships `RuleBasedInsightProvider`. Milestone 13 adds `AiInsightProvider` implementing the
same interface, behind an Edge Function that holds the model key. **The widget does not change** —
that is the acceptance test for the whole design.

Constraints fixed now: only **aggregates** leave the database (category totals, period sums,
trends), never raw transactions, never a merchant name; the model key never reaches the client;
model output is validated against the `Insight` schema before rendering; the feature degrades to the
rules provider when unavailable. Anything more (embeddings, a vector store, fine-tuning) is not
designed, because designing it now would be guessing.

---

## N. Git and Team Workflow — summary

Canonical detail, including the full Definition of Done: **[CONTRIBUTING.md](./CONTRIBUTING.md)**.
The decisions worth stating here because they are architectural:

**Trunk-based, not GitFlow — a deliberate departure from the brief.** `main` plus short-lived
branches (< 3 days), squash merge, preview deploy per PR. `develop` earns its keep only when there
is a *release train*; a continuously deployed web app has none, so `develop` becomes a branch merged
on a schedule for no benefit while doubling conflicts. **This changes at Milestone 11**, when a Play
Store binary becomes a real release train and `release/x.y` branches are cut from `main`.
([ADR-0013](./adr/0013-trunk-based-branching.md))

```
main ─────●────●────●────●────●────●──────────────▶  always deployable
           \      \       \           \
            ● ●    ● ●     ● ●         ● ●            feature/*  (< 3 days)
                                        \
                                         ●───●──▶     release/1.0 (from M11)
```

**Branch naming:** `feature/<milestone>-<slug>`, `fix/<slug>`, `db/<slug>` (anything carrying a
migration — the one file type where parallel branches genuinely collide), `docs/<slug>`,
`chore/<slug>`. Conventional Commits, enforced by `commitlint`.

**Review gates:** one approval to merge; **two** for `supabase/migrations/**`, any RLS policy or
`GRANT`, `src/domain/money/**`, `src/domain/period/**`, or authentication. PRs under ~400 lines.

**Four mechanisms that make parallel work actually parallel** — because "we'll coordinate" is not a
mechanism:

1. **Vertical feature ownership.** One developer owns a milestone slice end to end (UI + domain +
   repository + migration). Two developers on `transactions` and `goals` touch almost disjoint files.
2. **Interfaces first.** The repository interface and Zod schema land in a separate, tiny,
   fast-merged PR *before* implementation, so the UI developer builds against a fake repository
   while the data developer builds the real one.
3. **Migrations are append-only and timestamped.** Two branches adding tables produce two files, not
   a conflict. The rule that makes this safe: **never edit a merged migration.** Fix forward.
4. **The domain layer is the shared contract.** It changes rarely, is reviewed carefully, and has
   100% branch coverage, so a breaking change fails CI immediately rather than at integration.

**Definition of Done** — a feature is not done because the UI works. The full 30-item checklist is
in [CONTRIBUTING.md §6](./CONTRIBUTING.md), grouped as: code · database · security · errors ·
tests · UI · process. The four that get skipped under deadline pressure, and must not be: an RLS
matrix row for every new table; loading/empty/error states; no money or PII in any log; and a
migration that applies cleanly to an **empty** database.

---

## O. Development Roadmap — summary

Full milestone definitions with scope, dependencies, database changes, tests, acceptance criteria,
and risks: **[ROADMAP.md](./ROADMAP.md)**.

```
M0  Foundation            tooling, CI, boundaries lint, v1 cleanup, remove RECEIVE_SMS
M1  Auth + onboarding     profiles, seed categories, route guards, 4-step wizard
                          + gamification tables & award_xp (schema only — surfaces are M9)
M2  Accounts + ledger     ← the milestone everything downstream is arithmetic over
M3  Categories + splits + merchant categorisation
M4  Budget engine         periods, category limits, rollover, history
M5  Safe daily limit      ← proves the schema was right (no database change)
M6  Goals + contribution ledger
M7  Dashboard             ★ MVP SHIPS HERE
M8  Analytics + rules insights
M9  Gamification          surfaces only — XP/streak UI, check-in, achievements catalog
M10 Hardening             security, performance, accessibility, observability
M11 Android (Capacitor)   + offline outbox; release/* branching begins
M12 Ingestion (SMS | CSV) ← policy-gated; the test of whether the extension points were real
M13 AI insights           ← same InsightProvider interface, widget unchanged
```

**The MVP is Milestone 7.** Milestones 8–13 are amplifiers, and each can be cut without touching
what came before. The structural test of this architecture is that **nothing in M8–M13 changes the
schema of M0–M7**. If a later milestone needs a migration on a core table, an extension point was
imaginary and we will say so rather than migrate quietly.

M3/M6 and M8/M9 are the two genuine parallelisation points for a second developer.

---

## P. Risks & Tradeoffs

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| **R1** | **RLS misconfiguration exposes another user's financial data.** One missing policy on one new table is a full cross-tenant breach. This is the highest-severity risk in the system. | Critical | Deny-by-default (`REVOKE ALL FROM anon, authenticated` then grant narrowly); an automated **RLS test matrix** in CI that, for every table, signs in as user A and asserts SELECT/INSERT/UPDATE/DELETE against user B's rows all fail; `supabase db lint`; two approvals required on policy changes; a CI check that fails if a table in `public` has `rowsecurity = false`. |
| **R2** | **Client-side domain logic can be bypassed.** Anyone can call PostgREST with a raw token; the browser is not a trust boundary. | High | Every rule that *matters* is a database constraint, trigger, or RLS policy — not a TS function. XP, goal totals, and amount positivity are enforced in Postgres with column-level grants preventing client writes. The TS domain layer computes; it does not guard. |
| **R3** | **Supabase lock-in.** | Medium | Schema is plain SQL migrations; Postgres is portable to any provider. Business logic is in `domain/` (pure TS, zero Supabase imports) and behind repository interfaces. What *is* genuinely coupled: RLS policies and GoTrue auth. Migrating means porting policies to an application authorization layer — a real cost, accepted knowingly. |
| **R4** | **`bigint` money crossing JSON.** PostgREST serialises `int8` as a JSON number; values above `Number.MAX_SAFE_INTEGER` (2^53) would lose precision. | Low | 2^53 paise ≈ ₹90 trillion — far outside any plausible personal balance. Guarded anyway: the mapper asserts `Number.isSafeInteger` and throws a `data_access` error rather than corrupting silently. A `CHECK (amount_minor < 900000000000000)` backs it at the database — an integer literal, because `9e14` is a `double precision` literal and would put a float in the middle of the constraint that exists to keep floats out. |
| **R5** | **Android SMS reading may be blocked by Google Play policy.** `RECEIVE_SMS` is a restricted permission; Play requires the app to be the default SMS handler or to have an approved exception. The v1 manifest already declares it with no declaration filed — an app in that state can be rejected. **This risk can invalidate the entire Milestone 12 premise.** | High | (a) Treat SMS as *optional* and never a dependency of core value. (b) File a Play Console permissions declaration early, before building the feature, and get an answer. (c) Prepare fallbacks in priority order: user-initiated CSV/statement import; Android notification-listener parsing (different policy surface); India's RBI **Account Aggregator** framework for consented, regulated bank data. (d) The architecture already absorbs this: any ingestion source writes `transactions` with `source` + `status='pending_review'`, so the source is swappable. **Remove `RECEIVE_SMS` from the manifest in Milestone 0** until the feature is actually approved and built. |
| **R6** | **Timezone and period-boundary errors.** v1 shipped two. "Today" and "this month" are user-local concepts stored in a UTC database. | High | `occurred_on` is a `date` (civil, user-local), separate from `created_at timestamptz` (system). Profile stores an IANA timezone. `domain/period` is the only place date arithmetic happens, `Date.now()` is banned by lint, and tests run against a fixed clock in `Asia/Kolkata`, UTC, and `America/Los_Angeles`. |
| **R7** | **Gamification makes a finance app feel childish, or worse, rewards bad behaviour.** XP for "logging an expense" rewards activity, not health. | Medium | Gamification is opt-in and visually secondary (no confetti, no mascot). XP rules live in one config module and are reviewed as *product* decisions. Rules reward *outcomes* (stayed under budget, contributed to a goal) over *activity* where possible. An escape hatch: `gamification_events` is a ledger, so XP totals can be recomputed if a rule was wrong. |
| **R8** | **Offline behaviour in a mobile WebView.** Users log an expense on the move, often with no signal. Losing it is the fastest way to lose a user. | Medium | Not in MVP, but designed for: TanStack Query's persisted cache + mutation queue is the intended path (Milestone 11). Because writes go through repositories, an outbox implementation slots in without touching features. `client_request_id` already gives us idempotency keys for safe replay. |
| **R9** | **On-the-fly aggregation gets slow.** Per-category sums over years of transactions on every dashboard load. | Low now | Aggregates are already RPCs, so the *implementation* can become a materialized per-period rollup table without any client change. Indexes on `(user_id, occurred_on)` cover the MVP scale (A7) comfortably. |
| **R10** | **Scope creep — the roadmap describes 13 milestones of product.** The classic failure is building gamification and insights before transactions are solid. | Medium | The roadmap is strictly ordered and each milestone has acceptance criteria. Milestones 0–7 are the product; 8–13 are amplifiers. Nothing in 8–13 is allowed to change the schema of 0–7 (that's the test of whether the extension points are real). |
| **R11** | **Storing raw SMS text is a privacy liability** — bank messages contain account fragments, balances, and merchant history. v1 wrote full message bodies to Logcat and to an unencrypted Room database. | High (future) | If SMS ships: parse on-device, persist only the extracted fields, never the raw body; never log the body at any level; encrypt local storage (SQLCipher / EncryptedSharedPreferences); no raw SMS ever leaves the device. |
| **R12** | **Two people, one architecture document.** Decisions get relitigated in PR comments six weeks later. | Low | ADRs (§Q). A decision with a written ADR is a decision; anything else is a preference. |

### Tradeoffs accepted, stated plainly

- **No backend server** buys speed and removes a deployment, and costs us the ability to keep any logic secret from the client. Accepted because nothing in a personal finance MVP needs to be secret from its own user — only *isolated* from other users, which RLS does better than an API tier would.
- **Client-side calculation** buys instant, offline-capable UI and costs us the guarantee that displayed numbers were computed by trusted code. Accepted because the inputs are the user's own data and no decision of ours depends on the output.
- **Per-user seeded categories** costs twelve rows per signup and buys trivially simple RLS and full user customisation. Cheap trade.
- **`bigint` minor units** costs a conversion at every boundary and buys exactness. Non-negotiable for money.
- **Vertical feature slices** cost some duplication between features early and buy near-conflict-free parallel development. Correct at this team size.

---

## Q. Architecture Decision Records

Written and living in **[docs/adr/](./adr/README.md)**. Each has Context · Decision · Alternatives ·
Reasoning · Tradeoffs · Consequences. These are the calls a future developer would otherwise reverse
by accident.

| ADR | Title | Why it must be recorded |
|---|---|---|
| [0001](./adr/0001-rebuild-rather-than-refactor.md) | Rebuild rather than refactor v1 | The reboot premise; what was salvaged and why |
| [0002](./adr/0002-typescript-strict.md) | TypeScript with `strict` everywhere | Names the specific v1 bugs types would have caught |
| [0003](./adr/0003-supabase-as-backend.md) | Supabase as the backend; PostgreSQL as the application server | The biggest structural decision; alternatives and exit cost |
| [0004](./adr/0004-no-node-api-tier.md) | No Node/Express API tier; Edge Functions only where a secret is needed | Prevents someone "adding a proper backend" without cause |
| [0005](./adr/0005-money-as-bigint-minor-units.md) | Money as `bigint` minor units with an in-house `Money` type | Prevents a future `number` creeping in; documents the dinero.js path |
| [0006](./adr/0006-occurred-on-date-not-timestamptz.md) | `occurred_on date` + user timezone, not `timestamptz` | The most subtle correctness decision in the schema |
| [0007](./adr/0007-calculations-in-ts-invariants-in-postgres.md) | Calculations in TypeScript, invariants in PostgreSQL | The core layering rule; the thing most likely to erode |
| [0008](./adr/0008-per-user-seeded-categories.md) | Per-user seeded categories instead of shared system rows | Non-obvious; a future developer will want to "normalise" it back |
| [0009](./adr/0009-composite-foreign-keys.md) | Composite foreign keys `(id, user_id)` | Unusual technique; needs its rationale preserved |
| [0010](./adr/0010-goal-progress-trigger-maintained.md) | Goal progress as a trigger-maintained cache over a ledger | Explains why `saved_minor` is not client-writable and why it is recomputed, not incremented |
| [0011](./adr/0011-react-router-over-tanstack-router.md) | React Router 7 over TanStack Router | A close call; record it so it is not relitigated |
| [0012](./adr/0012-tanstack-query-only-state-library.md) | TanStack Query as the only state library at MVP | Documents the trigger for adding Zustand |
| [0013](./adr/0013-trunk-based-branching.md) | Trunk-based branching now, `release/*` from Milestone 11 | Departs from the brief; the reasoning must survive |
| [0014](./adr/0014-radix-primitives-vendored.md) | Radix primitives vendored, not a component library | Accessibility rationale |
| [0015](./adr/0015-sms-ingestion-policy-gated.md) | SMS ingestion is optional and policy-gated; fallbacks ranked | Records R5 before anyone builds on the assumption |
| [0016](./adr/0016-gamification-server-authoritative.md) | Gamification as an append-only ledger, XP server-awarded only | Records the v1 exploit being closed |
| [0017](./adr/0017-single-row-transfers-with-entry-view.md) | One transaction row per transfer, expanded by a view | Explains why this is not full double-entry, and what it would cost to become so |
| [0018](./adr/0018-refunds-net-against-spend.md) | Refunds net against spending rather than counting as income | Overrides an earlier assumption; the second pass changed the schema |
| [0019](./adr/0019-insert-column-grants.md) | Column-level `INSERT` grants for authoritative columns | Closes the half of the column-grant control that `UPDATE`-only protection left open |
| [0020](./adr/0020-rls-execution-model.md) | RLS execution model: `FORCE`, `BYPASSRLS`, definer and trigger privileges | Verified rather than assumed; its failure mode is silent, so it must not be rediscovered |
| [0021](./adr/0021-safe-daily-limit-income-basis.md) | Safe daily limit income basis is `greater` | Supersedes assumption A9; the product's hero number |
| [0022](./adr/0022-drop-regex-match-type.md) | `regex` dropped from `match_type` for the MVP | Records the direction of travel: adding an enum value is cheap, removing one is not |

---

## R. Architectural Self-Review

A second pass over this design, read as an unsympathetic reviewer would read it. **Findings that
changed the architecture are marked "FIXED" and the change is already reflected above.** Findings
that are accepted risks are marked as such, because an unfixed problem you have named is a
different thing from one you have not noticed.

### R.1 Where can money become inconsistent?

Almost nowhere, and that is by construction rather than by care: balances, budget spend, category
totals, savings rate, and XP level are all **derived at read time**. There is exactly one stored
derived value in the system.

| Surface | Verdict |
|---|---|
| `goals.saved_minor` | The one denormalisation. Bounded by: recompute-not-increment, same transaction, `FOR UPDATE` lock, a CI test asserting equality after a randomised concurrent workload, and `recompute_goal_totals()` as a repair path |
| `gamification_profiles.xp_total` | Same pattern over `gamification_events`; rebuilt by `recompute_xp_totals()` ([DATABASE.md §10](./DATABASE.md)). **FIXED:** this row claimed the total was "recomputable" for three drafts while no such function was ever listed. It is now named, owned, and `service_role`-only, symmetric with `recompute_goal_totals()` |
| `transactions.is_split` | A boolean that only selects a query shape. Trigger-maintained, and now absent from the client's INSERT grant as well as its UPDATE grant. **FIXED:** while `is_split` was insertable, a client could set it `true` with no split rows — `enforce_split_total()` is a constraint trigger on `transaction_splits`, so with zero children it never fires. The row then joins `transaction_category_amounts` with a `NULL` category, which is a wrong number in every category breakdown, not a slower query |
| Everything else | Derived. Cannot drift |
| **FIXED** | An earlier draft had a `goals.status` column *and* `saved_minor` *and* `target_minor` — three facts that could disagree. `status` is now derived from `archived_at` and `saved >= target`. Likewise `profiles.level` (v1 stored it) is now a pure function |

### R.2 Where can a malicious client manipulate data?

Walked the attack surface as an authenticated user with a valid token and full request control:

| Attempt | Blocked by |
|---|---|
| `PATCH /goals {saved_minor}` | No column `UPDATE` grant → `42501` |
| `POST /goals {saved_minor: target}` | No column `INSERT` grant → `42501`. **FIXED:** column grants covered `UPDATE` only until [ADR-0019](./adr/0019-insert-column-grants.md); a goal could be *born* complete, and `sync_goal_saved()` fires on contributions, so nothing would ever correct it |
| `POST /categories {is_system: true}` · `POST /transactions {status, source, is_split}` | Same fix, same mechanism |
| `PATCH /gamification_profiles {xp_total}` | No table write grant at all |
| `POST /transactions {user_id: victim}` | `WITH CHECK` on INSERT |
| `PATCH /transactions {user_id: victim}` | `WITH CHECK` on UPDATE **and** `user_id` excluded from the grant |
| `POST /transactions {category_id: <someone else's>}` | Composite FK → `23503` |
| `POST /transactions {amount_minor: -5000}` | `CHECK (amount_minor > 0)` |
| Replaying a captured `daily_check_in` 100× | `UNIQUE (user_id, dedupe_key)` |
| Spoofing `p_today` to inflate a streak | Server clamps the increment and bounds the date |
| Editing a closed budget period | RLS policy includes `closed_at IS NULL` |
| Calling an RPC with another user's id | Every **client-callable** RPC derives `auth.uid()`. Two internal functions do take a user id — `evaluate_achievements(p_user_id)` and `recompute_goal_totals(p_user_id)` — and neither is granted to `authenticated`; the grant, not the signature, is the control, and CI asserts no `authenticated`-executable function takes one ([SECURITY.md §4.5 rule 2, §8.2](./SECURITY.md)) |
| **Remaining** | A user can tamper with their *own* displayed calculations in their own browser. Accepted and recorded — nothing of ours depends on that output, and "fixing" it by moving arithmetic into RPCs would make the UI slow for no security gain |

### R.3 Where can duplicate transactions occur?

Double-tap, network retry, two devices, offline replay, SMS re-delivery, CSV re-import.
All six collapse into one mechanism: **`client_request_id` unique per user**, generated once per
form submission and reused on every retry, plus `dedupe_hash` for ingested rows. The second write
is a `23505` that the repository maps to "already saved" and returns the existing row.

**FIXED:** an earlier draft treated duplicate detection as an ingestion concern only. It is now a
property of every write path, including manual entry — because the double-tap case is far more
common than the SMS case and was otherwise unhandled.

### R.4 Where can timezone bugs occur?

`LocalDate.fromInstant` is the single conversion point in the entire system, and `Date.now()` is
lint-banned inside `domain/`. Period boundaries, "today", streaks, and daily limits all consume a
`LocalDate` passed in. The date suite runs in three timezones in CI.

**Remaining risk, named:** the *server* also has a notion of today, in `daily_check_in` and
`ensure_budget_period`. Those functions accept the client's `p_today` and validate it against the
server date within a tolerance wide enough to cover any real timezone offset. A user whose device
clock is deliberately wrong can shift their own period boundary by up to a day.

The consequence is **not only a slightly wrong personal streak**, which is what an earlier draft of
this row claimed. `ensure_budget_period` also *closes* any period whose end has passed, using that
same client-supplied date, and a closed period is read-only under the RLS policy — so a wrong clock
can end a budget period early. The exact tolerance, and whether closing should happen on the app-launch
path at all, are open questions against Milestone 4; they are not settled by this row. Accepted in
principle — the alternative is storing the user's zone and doing `now() AT TIME ZONE tz` in SQL,
which re-introduces exactly the conversion this design removed.

### R.5 Where is business logic duplicated?

Three honest answers:

1. **Validation exists twice** — Zod for UX, `CHECK`/trigger for truth. This is intentional defence
   in depth at a trust boundary, in two different *forms*, not one rule copied.
2. **XP rules exist twice** — a TypeScript catalog so the UI can predict optimistically, and
   `award_xp` calls in SQL as the authority. **This is the one genuine duplication in the design.**
   Bounded by keeping the catalog to eight event types, and by a test asserting the two agree. If
   it grows, the fix is to make the SQL read the catalog from a table.
3. **Category slugs** appear in seed SQL and in the TypeScript default list. Fixed by making the
   SQL seed authoritative and generating the TS constants from it in CI.

### R.6 Which parts are over-engineered?

Asked honestly, with a bias toward cutting:

| Candidate | Verdict |
|---|---|
| `transaction_splits` at MVP | **Borderline.** A supermarket receipt split across groceries and household is a real need, but it costs a deferred constraint trigger and a `LEFT JOIN` in every analytics query. **Kept**, because retrofitting it later would change `transaction_category_amounts`, which every analytics query depends on |
| `audit_log` | **Kept.** "Why did my budget change?" is unanswerable without it, and it is the incident-response substrate. Cost: one trigger and one table |
| `merchant_rules.match_type = 'regex'` | **Over-engineered — and now removed.** `contains`/`prefix`/`exact` cover every rule in the M3 fixtures, and `regex` added a ReDoS surface for one power user. Dropped from the enum before implementation ([ADR-0022](./adr/0022-drop-regex-match-type.md)), which retires threat T17 outright. Reintroducing it needs a new ADR — deliberately, because removing an enum value after rows reference it is a type rewrite, while adding one is a single `ALTER TYPE` |
| `transactions.metadata jsonb` | **Borderline.** An escape hatch that becomes a dumping ground. Kept with a size `CHECK` and the rule that nothing load-bearing may live in it |
| `categories.parent_id` | **Kept, unused at MVP.** One nullable column with a composite self-FK; adding it later means a migration on the most-referenced table |
| Financial health score | **Deferred to M8** rather than designed in detail now — the component weights are a product decision that needs real data |
| `get_dashboard_snapshot` | Would be over-engineering at three widgets. At nine, on 3G, it is the difference between usable and not |

### R.7 Which parts are under-engineered?

| Gap | Position |
|---|---|
| **Per-user write rate limiting** | Genuinely missing. PostgREST enforces none and Supabase's gateway limits are per-IP. Named in [SECURITY.md §6](./SECURITY.md) with a ready design. Accepted for MVP; a scripted client can create rows as fast as the network allows |
| **Offline** | Read cache + write outbox only, arriving at M11. A user with no signal for a day cannot browse history. Deliberate: full offline-first means conflict resolution on money |
| **Multi-currency** | Columns exist, logic does not. Any user with two currencies gets wrong totals today. Mitigation: the UI offers one currency per user until it is built |
| **Recurring transactions** | `upcomingPlanned` is in the safe-daily-limit contract and always zero. The number is therefore optimistic for anyone with a large mid-month debit. **This is the most user-visible gap in the MVP** and should be the first post-M7 feature |
| **MFA** | Supabase supports TOTP; scheduled for M10 |
| **Bulk operations** | No multi-select delete or bulk recategorise. Painful after an import; fine before one |

### R.8 What happens when two requests arrive at once?

Enumerated in [DATABASE.md §12](./DATABASE.md) and integration-tested, including 20 parallel
contributions to one goal asserting an exact total. The design uses `READ COMMITTED` with row locks
and unique constraints rather than `SERIALIZABLE`, because no RPC performs a read-then-write that a
unique index or `FOR UPDATE` does not already protect — a claim the concurrency tests exist to
falsify.

### R.9 What happens if the database is unavailable?

The app is a static bundle, so it loads. Then:

- **Reads** serve from the TanStack Query cache (persisted from M11) with a visible staleness
  marker.
- **Writes** fail with a `network` error, retry with backoff, and from M11 queue in the outbox.
- **Auth** fails; an existing session keeps working until the access token expires (up to 1 hour),
  because token validation is local until a refresh is needed.
- **The honest gap before M11:** a write during an outage is lost from the UI and the user must
  retype it. Mitigated by keeping the form's values on failure rather than clearing them — a small
  thing that matters a lot at that moment.

Supabase availability is a single point of failure we do not control. Accepted with the vendor
choice ([ADR-0003](./adr/0003-supabase-as-backend.md)).

### R.10 What happens at 100,000 users?

Nothing structural. RLS scopes every query to one user, so the working set is per-user and the
indexes are `(user_id, …)` prefixed. The concerns, in order of arrival:

1. **`get_period_summary` at 50k+ transactions per user.** Mitigation is already designed: the
   aggregate is an RPC, so it becomes a `period_rollups` read without any client change.
2. **`audit_log` growth** — the fastest-growing table. Needs monthly partitioning and a 24-month
   retention policy before it becomes a problem.
3. **Connection pooling** — Supabase's Supavisor handles this; verify the plan's limits before
   launch.
4. **Categories at 1.2M rows** (12 per user). Trivial for PostgreSQL with a `(user_id, …)` index.

### R.11 What would make Android/SMS integration difficult?

The three things that would have, and how each is already avoided:

- **Business logic in components** would mean the WebView and any native path compute differently.
  Prevented by the boundary lint rule.
- **A schema with no provenance model** would force a migration on `transactions` for the first
  ingestion source. Prevented: `source`, `status`, `dedupe_hash`, and `external_ref` exist from M2,
  and M12 is explicitly the test of whether that was real.
- **A core feature depending on SMS.** Prevented by policy: the web app has no dependency in either
  direction, and the fallbacks are ranked in [ADR-0015](./adr/0015-sms-ingestion-policy-gated.md).

**What remains genuinely hard**, and is not an architecture problem: Google Play approval, and
parser accuracy across banks that change their formats without notice.

### R.12 What would make AI integration difficult?

- **Insights computed inline in a widget** would have to be rewritten. Prevented: the
  `InsightProvider` interface exists from M8 with a rules implementation behind it.
- **No aggregate layer** would force sending raw transactions to a model — a privacy problem and a
  cost problem. Prevented: aggregates already exist as RPCs, and the constraint that only aggregates
  leave the database is fixed now, before anyone builds against it.
- **A model key needed client-side.** Prevented: Edge Functions exist for exactly this.

### R.13 Which indexes are missing?

Reviewed against every query shape in [API.md](./API.md). The second pass added four that a first
pass would have missed:

1. **`tx_user_counter_idx`** — a partial index on `(user_id, counter_account_id, occurred_on)`.
   Without it the *second* branch of `account_entries` (transfers in) sequentially scans, so every
   balance query is half-indexed and the bug is invisible until a user has transfers. **FIXED**
2. **`tx_review_queue_idx`** — partial on `status IN ('detected','pending_review')`. Not needed
   until M12, but adding an index to a large table later is a lock; adding it at creation is free.
3. **`tx_search_trgm_idx`** — a GIN trigram index for the description/merchant search filter, which
   would otherwise be `ILIKE '%…%'` over the user's whole history.
4. **The idempotency uniques** — `(user_id, client_request_id)` and `(user_id, dedupe_hash)`, both
   partial. These are correctness constraints that happen to be indexes.

Still to verify by measurement in M10, not by assertion now: whether
`(user_id, occurred_on desc, id desc)` is enough for the list *and* the period aggregates, or
whether the aggregate wants its own covering index.

### R.14 Which RLS policies are dangerous?

| Pattern | Status |
|---|---|
| `FOR ALL USING (...)` with no `WITH CHECK` (v1's shape on `expenses`, `goals`, `budgets`; `profiles` had the same hole via a separate `FOR UPDATE` policy) | **Eliminated.** Four explicit policies per table, `WITH CHECK` on every INSERT and UPDATE |
| A view without `security_invoker = true` | **Would be a silent full RLS bypass.** Every view sets it, and a CI query over `pg_class.reloptions` fails the build otherwise. **This is the single most dangerous thing in the design if forgotten** |
| `SECURITY DEFINER` without `SET search_path = ''` | v1's `handle_new_user` had this. All definer functions now pin it, CI-asserted |
| Policies referencing another table without care | Avoided: every policy is `user_id = (select auth.uid())`. No policy performs a subquery against another user-owned table, so there is no policy-evaluation-order surprise |
| `RLS ENABLE` without `FORCE` | Would exempt the table owner — and migrations run as the owner. Both are set, CI-asserted. **Corrected:** an earlier draft also credited `FORCE` with stopping a `SECURITY DEFINER` bypass. It does not — the owning role holds `BYPASSRLS`, which defeats `FORCE`, and that is precisely what lets the trigger-maintained columns work. Verified execution model in [ADR-0020](./adr/0020-rls-execution-model.md) |
| A `SECURITY DEFINER` function owned by a role **without** `BYPASSRLS` | **The most dangerous failure mode found in this review.** Its `UPDATE`s match zero rows and return success — no error, a silently wrong total — and its `SELECT`s are filtered, so a recompute reads an empty ledger and writes `0`. Guarded by a CI query asserting every definer function's owner holds `rolbypassrls` |
| A trigger function that writes a protected column without `SECURITY DEFINER` | Fails `42501` and rolls back the user's whole write. Loud rather than silent, but still broken. Both `sync_goal_saved()` and `enforce_split_total()` are definer for this reason |
| A new table with no policy | The highest-probability future failure. Mitigated by generating the RLS test matrix from a table list and by a CI query for `relrowsecurity = false` |

### R.15 Which denormalised fields could become inconsistent?

Exactly two (`goals.saved_minor`, `gamification_profiles.xp_total`), both caches over their
ledgers, both recomputed rather than incremented, both with a named repair function
(`recompute_goal_totals()` and `recompute_xp_totals()`, [DATABASE.md §10](./DATABASE.md)), both
with a CI test asserting equality after concurrent writes. Plus `transactions.is_split`, now
protected on insert as well as update (§R.1).

**FIXED in this pass:** `budget_periods` originally carried a generated `label` column; `to_char`
on a date is `STABLE`, not `IMMUTABLE`, so PostgreSQL rejects it in a generated column. The label is
formatted in `domain/period` instead. Similarly, the "not more than 5 years in the future" bound on
`occurred_on` cannot be a `CHECK` (it needs `current_date`) and is now a `BEFORE` trigger. Both are
the kind of error that is only found by writing the SQL out and reading it, which is why it was
written out.

### R.16 Summary of changes made by this review

| # | Finding | Change |
|---|---|---|
| 1 | Refunds-as-income corrupts both the savings rate and category budgets | New `kind='refund'` that nets against spend; [ADR-0018](./adr/0018-refunds-net-against-spend.md); assumption A8 overridden in writing |
| 2 | The safe daily limit could not distinguish committed from discretionary spend | Added `categories.treatment` (`fixed`/`variable`/`excluded`) — without it the signature feature is wrong for anyone with rent |
| 3 | A stored `goals.status` was a third fact that could disagree | Removed; derived from `archived_at` and `saved >= target` |
| 4 | `CHECK` with `current_date` is invalid PostgreSQL | Moved to a `BEFORE` trigger |
| 5 | A generated `label` column with `to_char` is invalid PostgreSQL | Removed |
| 6 | The transfer-in branch of `account_entries` had no index | Added `tx_user_counter_idx` (partial) |
| 7 | Idempotency was designed for ingestion only | `client_request_id` extended to every write path, including manual entry |
| 8 | Views would silently bypass RLS | `security_invoker = true` on all three, plus a CI assertion |
| 9 | Nine dashboard queries on a 3G phone | `get_dashboard_snapshot` RPC |
| 10 | `merchant_rules` `regex` matching adds a ReDoS surface for no MVP benefit | Removed from the enum; [ADR-0022](./adr/0022-drop-regex-match-type.md) |

Ten findings, eight fixed in the design, two recorded as accepted risks with named triggers. A
review that found nothing would mean the review was not real.

### R.17 Second review pass — cross-document audit

A later pass compared all ten documents against each other and against the v1 code, rather than
reading each on its own. It found 45 conflicts and gaps; the five that changed the architecture are
below, and the rest are corrections already applied across the documents they belonged to.

| # | Finding | Change |
|---|---|---|
| 11 | Column grants covered `UPDATE` only, so `saved_minor`, `is_system`, `status` and `is_split` were all settable at row creation — and `sync_goal_saved()` never fires on a goal insert, so a fabricated total would stand forever | Column-level `INSERT` grants mirroring the `UPDATE` grants; [ADR-0019](./adr/0019-insert-column-grants.md) |
| 12 | The `SECURITY DEFINER` / `FORCE RLS` interaction was assumed rather than tested. A definer function's reads *and* writes are policed by RLS, and an under-privileged `UPDATE` fails **silently** | Execution model verified against PostgreSQL 15 and `supabase/postgres`, written up as [ADR-0020](./adr/0020-rls-execution-model.md), with two new CI assertions |
| 13 | Assumption A9 (`planned` income) contradicted FINANCIAL-ENGINE's `greater` default for the product's hero number, and was never marked superseded | A9 struck; [ADR-0021](./adr/0021-safe-daily-limit-income-basis.md) records the basis and both alternatives |
| 14 | `handle_new_user` writes a `gamification_profiles` row in M1, but the table was created in M9 — a cycle in the milestone graph, and the migration list created the trigger two files before the categories it inserts | Gamification **schema** moves to M1, surfaces stay in M9; signup trigger split into its own migration ([DATABASE.md §13](./DATABASE.md)) |
| 15 | Finding 10 above was recorded as a *recommendation* and never actioned in the schema, so `regex` was still in the enum three documents later | Decided and applied; enum values are cheap to add and expensive to remove, so the direction matters |

Two of these — 11 and 12 — were holes in the control DATABASE P2 calls the most important in the
system. Both were invisible from inside any single document, which is the argument for reading a
design as a set rather than as a stack.
