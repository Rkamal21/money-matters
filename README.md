# 💰 Money Matters

**Track smart. Save smarter.** A personal finance application that goes beyond expense tracking —
it answers _where is my money going_, _how much can I safely spend today_, and _am I getting closer
to my goals_. Amounts are in ₹ (INR). Mobile-first web app, shipped to Android via Capacitor.

---

## Status: Milestone 0 — Foundation

v1 has been removed. The repository now contains the **complete architecture blueprint for 2.0** in
`docs/`, and the Milestone 0 foundation that implements it: toolchain, layer boundaries, validated
configuration, local Supabase, the CI pipeline, and one working test at each of the four levels.

**There are no product features yet.** Authentication and onboarding are
[Milestone 1](./docs/ROADMAP.md); the transaction ledger is Milestone 2. `src/domain/`,
`src/features/`, `src/components/` and `src/platform/` are deliberately empty — each holds a
`README.md` naming the milestone that fills it.

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
| [docs/adr/](./docs/adr/README.md)                      | 25 Architecture Decision Records                                                  |

### What changed from v1

|                  | v1                                    | 2.0                                                                                   |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| Language         | JavaScript                            | TypeScript, `strict`                                                                  |
| Money            | `DECIMAL(10,2)` → JS `Number` (float) | `bigint` minor units + a `Money` value object                                         |
| Dates            | UTC string compared to `timestamptz`  | `occurred_on date` + the user's IANA timezone                                         |
| Model            | `expenses` only                       | accounts · income · expense · **transfer** · refund · splits                          |
| Budget           | one row per user, no period           | `budget_periods` with history, category limits, rollover                              |
| Safe daily limit | `(income − fixed − savings) / 30`     | a tested engine that knows the period, the days left, and what you have already spent |
| Goals            | a client-writable `current` column    | an append-only contribution ledger; progress is not client-writable                   |
| XP               | a client-writable `xp` column         | a server-awarded, deduplicated event ledger                                           |
| Security         | `FOR ALL` policies, no `WITH CHECK`   | four explicit policies per table, composite FKs, column grants                        |
| Tests            | none                                  | ~600, with 100% branch coverage on the financial domain                               |

The v1 source, its schema, and the unfinished Android SMS receiver were deleted in Milestone 0. The
SMS parser regexes are preserved as reference material for Milestone 12 in
[ADR-0015](./docs/adr/0015-sms-ingestion-policy-gated.md), and the `RECEIVE_SMS` permission is gone
from the manifest — declaring a Google Play restricted permission for an unimplemented feature risks
rejection of any store submission ([SECURITY.md §9](./docs/SECURITY.md), risk R5).

---

## Getting started

```bash
git clone <repo> && cd money-matters
npm ci                       # never `npm install` — the lockfile is the contract
cp .env.example .env         # fill in from `npx supabase start`, or Supabase → Project Settings → API

npx supabase start           # local Postgres + Auth + Studio in Docker
npx supabase db reset        # applies every migration from zero, then seed.sql

npm run dev                  # http://localhost:5173
```

Verify the setup before writing code:

```bash
npm run typecheck && npm run lint && npm test && npm run test:integration
```

**Never point local development at the production Supabase project.** A migration applied by
accident is not reversible. `tests/integration/db.ts` refuses any host that is not local, but the
`.env` file is on you.

### The local database

`npx supabase db reset` drops the database, applies every migration in
`supabase/migrations/` in order, then runs `supabase/seed.sql`. It is the same thing CI does on
every pull request, which is what makes "a migration that only works against your database is not a
migration" ([DATABASE.md §13](./docs/DATABASE.md)) an enforced rule rather than a slogan.

At Milestone 0 there is one migration and it creates no tables: extensions and the enum types from
[DATABASE.md §5](./docs/DATABASE.md). Every table lands in M1 or later.

| Service      | URL                                                       |
| ------------ | --------------------------------------------------------- |
| API          | http://127.0.0.1:54321                                    |
| Postgres     | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio       | http://127.0.0.1:54323                                    |
| Mail catcher | http://127.0.0.1:54324                                    |

Stop it with `npm run db:stop`. Docker must be running.

### Scripts

| Script                                      | Does                                                       |
| ------------------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                               | Vite dev server                                            |
| `npm run build`                             | Category-constant check, `tsc -b`, then production build   |
| `npm run typecheck`                         | `tsc --noEmit`                                             |
| `npm run lint` / `lint:fix`                 | ESLint, including the layer boundaries                     |
| `npm run format` / `format:check`           | Prettier                                                   |
| `npm test`                                  | Unit + component (no database needed)                      |
| `npm run test:integration`                  | Integration + RLS against local Supabase                   |
| `npm run test:e2e`                          | Playwright                                                 |
| `npm run test:coverage`                     | Unit + component with coverage                             |
| `npm run gen:categories`                    | Regenerate the category constants from `supabase/seed.sql` |
| `npm run gen:types`                         | Regenerate `database.types.ts` from the local schema       |
| `npm run db:start` / `db:stop` / `db:reset` | Local Supabase                                             |
| `npm run cap:sync` / `cap:android`          | Capacitor                                                  |

---

## Layout

```
src/         application source — one README.md per directory stating what it owns
supabase/    config.toml, migrations/, seed.sql, generated/
tests/       unit/ component/ integration/ rls/ e2e/ setup/
scripts/     build-time generators and checks
docs/        the architecture blueprint; the specification this code implements
.github/     the CI pipeline from TESTING.md §8
```

Dependencies point downward only, and that is enforced mechanically: `eslint.config.js` encodes the
layering, the `domain/`-purity bans, the "no Supabase client outside `data/`" rule, and the
`import.meta.env` restriction. `tests/unit/architecture-rules.test.ts` tests those lint rules, so a
rule that stops working fails a test rather than going quietly unenforced.

---

## Hosting

**Vercel**, with a preview deployment per pull request.

The choice is recorded here rather than in an ADR because it is reversible in an afternoon — the
build output is a static bundle either way, and Cloudflare Pages would serve it equally well
([ARCHITECTURE.md §C.5](./docs/ARCHITECTURE.md)). What is not optional is the preview deploy:
reviewers should click, not clone.

Deployment settings: build command `npm run build`, output directory `dist`, and the `VITE_*`
variables from `.env.example` configured per environment. Nothing here is a secret — see
[`src/config/README.md`](./src/config/README.md) for why the anon key is on the public list and a
`service_role` key can never be.

---

_Money Matters_ — one place to track spending, hit goals, and see where your money goes.
