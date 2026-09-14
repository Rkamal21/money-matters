# 💰 Money Matters

**Track smart. Save smarter.** A personal finance application that goes beyond expense tracking —
it answers _where is my money going_, _how much can I safely spend today_, and _am I getting closer
to my goals_. Amounts are in ₹ (INR). Mobile-first web app, shipped to Android via Capacitor.

---

## Status: the MVP (Milestones 1–7), plus analytics and gamification (8–9)

The product described in [docs/](./docs/ARCHITECTURE.md) is built and running end to end:

| Area                 | What you can do                                                                                                                                                                           | Milestone |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **Auth**             | Sign up with email confirmation, sign in, reset and change password, sign out everywhere, delete your account                                                                             | M1        |
| **Onboarding**       | Four steps — income and month start day, first account, savings target with an optional first goal, fixed costs                                                                           | M1        |
| **Ledger**           | Accounts (bank, cash, savings, credit card, wallet) with derived balances; expenses, income, **transfers**, refunds; splits; edit, delete with undo; URL-driven filters and keyset paging | M2        |
| **Categorisation**   | 12 editable categories (fixed / day-to-day / not counted), icons and colours; 56 merchant rules suggest a category as you type, and correcting one teaches a personal rule                | M3        |
| **Budget**           | A plan per financial month with full history, category limits with pace markers, optional rollover, closed periods read-only                                                              | M4        |
| **Safe daily limit** | The hero number, with a "why this number?" breakdown, today's share, and honest states (no budget yet · over · period ended)                                                              | M5        |
| **Goals**            | Each goal is the purpose of a wallet; add or withdraw money as transfers; required monthly saving; a projection that refuses to invent a date                                             | M6        |
| **Dashboard**        | One round trip (`get_dashboard_snapshot`), nine widgets from a registry, each with its own error boundary                                                                                 | M7        |
| **Insights**         | Income vs spending by month, 30-day spending, category changes against last period, financial health score, rule-based insights                                                           | M8        |
| **Progress**         | Server-awarded XP with daily caps, streak check-in, ten achievements, full XP history — optional, off in one switch                                                                       | M9        |

Light and dark themes (following the system by default), full keyboard and screen-reader support,
and a 360 px-first layout with a bottom tab bar and a thumb-reach add button.

**Not built yet:** hardening beyond what is below (M10), the Android build (M11), SMS / CSV import
(M12), AI insights (M13). See [docs/ROADMAP.md](./docs/ROADMAP.md).

### How it is checked

| Suite                                                                                           | Count            | Runs against               |
| ----------------------------------------------------------------------------------------------- | ---------------- | -------------------------- |
| Unit — the financial domain (with fast-check property tests), lint-rule tests, palette contrast | 322              | nothing (pure)             |
| Component — the app shell and the MSW harness                                                   | 7                | jsdom + MSW                |
| Integration — schema assertions, the RLS isolation matrix, ledger invariants                    | 122              | local Supabase             |
| E2E — the critical journey, axe on every key page, security journeys                            | 22 × 2 viewports | built app + local Supabase |

Initial JS load: ~186 KB gzipped (budget 200 KB); every page and the Sentry SDK are lazy chunks.

---

## Try it locally

Needs Node ≥ 20.19 and Docker.

```bash
npm ci
npx supabase start           # local Postgres + Auth + Studio in Docker
npx supabase db reset        # every migration from zero, then seed.sql (with a demo user)
```

Point the app at the local stack with a `.env.local` (gitignored; it overrides `.env`):

```bash
# values from `npx supabase status`
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
```

```bash
npm run dev                  # http://localhost:5173
```

Sign in as the seeded demo user — two months of realistic data:

| Email                     | Password            |
| ------------------------- | ------------------- |
| `demo@moneymatters.local` | `demo-password-123` |

Or sign up: the confirmation email lands in the local mail catcher at http://127.0.0.1:54324.

**Never point local development at the production Supabase project.** A migration applied by
accident is not reversible. The integration suite refuses any host that is not local; the `.env`
files are on you.

### Running the checks

```bash
npm run typecheck && npm run lint && npm test     # no database needed
npm run test:integration                          # local Supabase must be running
npm run test:e2e                                  # builds, serves on :4173, drives a browser
```

If Playwright cannot download its pinned Chromium, run the E2E suite on an installed browser:
`E2E_BROWSER_CHANNEL=msedge npm run test:e2e` (or `chrome`).

| Service      | URL                                                       |
| ------------ | --------------------------------------------------------- |
| API          | http://127.0.0.1:54321                                    |
| Postgres     | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio       | http://127.0.0.1:54323                                    |
| Mail catcher | http://127.0.0.1:54324                                    |

### Deploying the database

Migrations live in `supabase/migrations/` and are forward-only. To apply them to a hosted project:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies migrations only; seed.sql is never run remotely
```

Then set the hosted project's auth settings to match `supabase/config.toml` — email confirmation on,
a 10-character minimum password, and your site URL in the redirect allow-list.

### Scripts

| Script                                      | Does                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                               | Vite dev server                                                       |
| `npm run build`                             | Category-constant check, `tsc -b`, then production build              |
| `npm run typecheck`                         | `tsc --noEmit`                                                        |
| `npm run lint` / `lint:fix`                 | ESLint, including the layer boundaries                                |
| `npm run format` / `format:check`           | Prettier                                                              |
| `npm test`                                  | Unit + component (no database needed)                                 |
| `npm run test:integration`                  | Schema assertions, RLS matrix and ledger tests against local Supabase |
| `npm run test:e2e`                          | Playwright                                                            |
| `npm run test:coverage`                     | Unit + component with coverage                                        |
| `npm run gen:categories`                    | Regenerate the category constants from `supabase/seed.sql`            |
| `npm run gen:types`                         | Regenerate `database.types.ts` from the local schema                  |
| `npm run db:start` / `db:stop` / `db:reset` | Local Supabase                                                        |
| `npm run cap:sync` / `cap:android`          | Capacitor                                                             |

### Regenerating the lockfile

Not with a bare `npm install`. npm seeds the resolution from whatever `node_modules/` it finds, so
a lockfile regenerated in place on Windows records only Windows binaries and `npm ci` then fails on
the Linux CI runner. Regenerate from `package.json` alone, on Linux:

```bash
mkdir -p /tmp/lockgen && cp package.json /tmp/lockgen/
docker run --rm -v /tmp/lockgen:/work -w /work node:22 \
  npm install --package-lock-only --no-audit --ignore-scripts
cp /tmp/lockgen/package-lock.json .
```

---

## How it is built

**Start here:** [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — the hub, which points at everything
else.

| Document                                               | Owns                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)         | v1 audit, system architecture, tech stack, layering, frontend, state, self-review |
| [docs/PRODUCT.md](./docs/PRODUCT.md)                   | Vision, the core loop, MVP scope, users, dashboard composition                    |
| [docs/DATABASE.md](./docs/DATABASE.md)                 | ER diagram, full schema, money & date models, constraints, indexes, concurrency   |
| [docs/SECURITY.md](./docs/SECURITY.md)                 | Auth, RLS design, threat model, privacy, security testing                         |
| [docs/FINANCIAL-ENGINE.md](./docs/FINANCIAL-ENGINE.md) | Every money calculation, with assumptions and edge cases                          |
| [docs/API.md](./docs/API.md)                           | Service contracts, repository interfaces, RPCs, the error model                   |
| [docs/TESTING.md](./docs/TESTING.md)                   | Unit / component / integration / RLS / E2E strategy and CI                        |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)         | Git workflow, review rules, migration ownership, Definition of Done               |
| [docs/ROADMAP.md](./docs/ROADMAP.md)                   | Milestones 0–13                                                                   |
| [docs/adr/](./docs/adr/README.md)                      | 26 Architecture Decision Records                                                  |

```
src/
  domain/      pure TypeScript: Money (bigint), LocalDate, budget engine, safe daily limit,
               goals, categorisation, analytics, insights, health score — no React, no clock
  data/        the only layer that knows Supabase: client, repositories, row mappers,
               Postgres → AppError mapping, shared TanStack Query hooks
  features/    auth, onboarding, dashboard, transactions, budget, goals, insights,
               gamification, settings — each owns its routes, components, hooks, schemas
  components/  the shared design system (Radix-based sheet, fields, money, charts)
  app/         providers, guards, layouts, the route table
supabase/
  migrations/  15 forward-only files: tables, RLS, views, RPCs, audit, XP awards
  seed.sql     the authoritative category list, and a local demo user
tests/         integration/ rls/ e2e/ component/ unit/ setup/
```

Dependencies point downward only, enforced by `eslint.config.js` (layer boundaries, `domain/`
purity, no Supabase outside `data/`, no money arithmetic in components) and tested by
`tests/unit/architecture-rules.test.ts`.

**Where the build departs from the documents, and why**

- **Account deletion** is a `SECURITY DEFINER` RPC (`delete_my_account`) that deletes the caller's
  auth user, rather than an Edge Function holding `service_role`: same effect, derived from the
  JWT, and one fewer place the privileged key lives.
- **Read RPCs** (`get_period_summary`, `get_dashboard_snapshot`, analytics) are `SECURITY INVOKER`,
  so RLS does the work — SECURITY.md §4.5 rule 5 ("never definer for a plain read") wins over
  API.md §4's blanket "all are definer".
- **Foreign keys** use `NO ACTION` where DATABASE.md says `RESTRICT`: identical for a user's own
  deletes, but `RESTRICT` would make the account-deletion cascade fail.
- **The bundle budget** measures the initial load (entry + modulepreloads), as ARCHITECTURE.md §L
  and M10 describe it; route chunks have their own ceiling.

---

## Hosting

**Vercel**, with a preview deployment per pull request. Build command `npm run build`, output
directory `dist`, and the `VITE_*` variables from `.env.example` configured per environment.
Nothing there is a secret — see [`src/config/README.md`](./src/config/README.md) for why the anon
key is on the public list and a `service_role` key can never be.

---

_Money Matters_ — one place to track spending, hit goals, and see where your money goes.
