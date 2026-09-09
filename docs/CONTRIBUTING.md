# Contributing to Money Matters 2.0

Status: **Proposed** · Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) · Date: 2026-09-07

This is a financial application. Two rules override every other guideline here:

> **1. A number the user sees must be produced by tested, pure domain code.**
> **2. A rule that protects money or privacy must be enforced by PostgreSQL, not by TypeScript.**

Everything below exists to make those two rules survive contact with a team and a deadline.

---

## 1. Getting set up

```bash
git clone <repo> && cd money-matters
npm ci                       # never `npm install` — the lockfile is the contract
cp .env.example .env         # fill in from Supabase → Project Settings → API

npx supabase start           # local Postgres + Auth + Studio in Docker
npx supabase db reset        # applies every migration from zero, then seed.sql

npm run dev                  # http://localhost:5173
```

Verify the setup before writing code:

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
```

**Never point local development at the production Supabase project.** A migration applied by
accident is not reversible.

---

## 2. Branching

`main` + short-lived branches. Not `main ← develop ← feature/*`.

**Why this differs from the original brief:** `develop` earns its keep when there is a *release
train* — changes held back and shipped together. A continuously deployed web app has no train, so
`develop` becomes a branch merged to `main` on a schedule for no benefit, doubling merge conflicts
and creating "works on develop, broken on main" drift. With 2–5 developers and a preview deploy per
PR, `main` plus short-lived branches is faster and has fewer states to reason about.

**This changes at Milestone 11.** A Play Store binary *is* a release train — you cannot hotfix an
APK the way you redeploy a web bundle. At that point we add `release/x.y` branches cut from `main`,
with fixes cherry-picked back. A real reason, arriving at a known time. See
[ADR-0013](./adr/0013-trunk-based-branching.md).

```
main ─────●────●────●────●────●────●──────────────▶  always deployable
           \      \       \           \
            ● ●    ● ●     ● ●         ● ●            feature/*  (< 3 days)
                                        \
                                         ●───●──▶     release/1.0 (from M11)
```

### Branch naming

```
feature/<milestone>-<slug>     feature/m2-transaction-crud
fix/<slug>                     fix/streak-timezone-comparison
db/<slug>                      db/add-goal-contributions      ← anything with a migration
docs/<slug>                    docs/adr-0005-money-representation
chore/<slug>                   chore/upgrade-vite-7
```

`db/*` is called out separately because migrations are the one file type where parallel branches
genuinely collide. A branch carrying a migration says so in its name.

**Keep branches under three days.** A branch that lives a week is a merge conflict with a
changelog entry.

---

## 3. Commits

[Conventional Commits](https://www.conventionalcommits.org/), enforced by `commitlint` in a Husky
`commit-msg` hook.

```
<type>(<scope>): <subject>

feat(goals): add contribution ledger and progress trigger
fix(budget): use the user's timezone when resolving the current period
db(transactions): add a partial unique index on client_request_id
test(domain): cover the safe-daily-limit zero-days edge case
```

Types: `feat fix db docs test refactor perf chore ci`.
Scopes: `auth onboarding transactions accounts budgets goals dashboard analytics gamification insights domain data ui`.

The body explains **why**, not what — the diff already says what. Any commit that changes a money
calculation, a policy, or a constraint must say why in the body.

---

## 4. Pull requests

- **Under ~400 lines changed.** A PR touching five features is a PR nobody reviews properly; it
  gets an approval, not a review.
- **The template requires:** what changed, why, screenshots for UI, a migration note, and the
  Definition of Done checklist.
- **One approval to merge. Two approvals** for anything touching:
  - `supabase/migrations/**`
  - any RLS policy or `GRANT`
  - `src/domain/money/**` or `src/domain/period/**`
  - authentication
- **Squash merge** to `main` — one feature, one commit, a linear history `git bisect` can use.
- **CI must be green.** No "merging, will fix the test after".
- **A preview deploy link is posted automatically.** Reviewers click; they do not clone.

### What a reviewer is actually checking

1. Is there business logic in a component that belongs in `domain/`?
2. Is any authoritative value written by the client — on `INSERT` as well as `UPDATE`?
3. Does a new table have four RLS policies, composite FKs, and a row in the RLS test matrix?
4. Does new money code use `Money`, never `number`?
5. Does new date code take `today` as a parameter, never `new Date()`?
6. Are loading, empty, and error states implemented?
7. Could any log line or analytics event carry an amount, an email, or a token?
8. Is the migration safe to apply to a database that already has rows?

---

## 5. Parallel development

Four mechanisms, because "we'll coordinate" is not a mechanism.

1. **Feature ownership.** One developer owns a milestone slice end to end — UI, domain, repository,
   migration. Because features are vertical slices, two developers on `transactions` and `goals`
   touch almost disjoint file sets.
2. **Interfaces first.** The repository interface and the Zod schema for a feature land in a
   separate, tiny, fast-merged PR *before* the implementation. Everyone else then codes against the
   contract, and the UI developer builds against a fake repository while the data developer builds
   the real one.
3. **Migrations are append-only and timestamped.** Two branches adding a migration produce two
   files, not a conflict. The rule that makes this safe: **never edit a migration that has been
   merged.** Fix forward.
4. **The domain layer is the shared contract.** It changes rarely, is reviewed carefully, and has
   100% branch coverage — so a change that breaks another feature fails CI immediately rather than
   at integration time.

### Files that need a heads-up in Slack before you touch them

`src/domain/money/**`, `src/domain/period/**`, `src/app/router.tsx`, `src/lib/queryKeys.ts`,
`supabase/migrations/**` (the RLS file in particular), `src/styles/theme.css`.

### Migration ownership

- The developer who adds a table owns its migration, its RLS policies, its entry in the RLS test
  matrix, and its section in [DATABASE.md](./DATABASE.md). Not three people, and not "we'll add
  policies later".
- Regenerate types in the same PR: `npx supabase gen types typescript --local > src/data/supabase/database.types.ts`.
- Never edit a merged migration.
- Destructive changes are two-phase: add → backfill → switch reads → drop in a **later** release.

---

## 6. Definition of Done

A feature is not done because the UI works. It is done when **all** of the following hold.

**Code**
- [ ] Acceptance criteria from the milestone are met
- [ ] TypeScript strict; no `any`; no `@ts-expect-error` without a linked issue
- [ ] Business logic lives in `src/domain/`, pure, framework-free — **not in a component**
- [ ] Money uses `Money`; no `number` arithmetic on an amount
- [ ] Dates take `today`/`Clock` as a parameter; no `new Date()` in `domain/`
- [ ] No `import { supabase }` outside `src/data/supabase/`
- [ ] Boundary lint rules pass

**Database**
- [ ] Migration applies cleanly to an **empty** database and to one with existing rows
- [ ] New table: `user_id`, `UNIQUE (id, user_id)`, composite FKs, RLS enabled **and** forced,
      four explicit policies with `WITH CHECK`, indexes for its query patterns
- [ ] Derived or authoritative columns have no client `INSERT` grant **and** no client `UPDATE`
      grant — both halves, or the column is settable at row creation (ADR-0019)
- [ ] Any trigger or function writing such a column is `SECURITY DEFINER` with
      `SET search_path = ''`, and its owner holds `BYPASSRLS` (ADR-0020) — an under-privileged
      definer `UPDATE` fails silently, so this is not something a smoke test will catch
- [ ] `database.types.ts` regenerated and committed

**Security**
- [ ] Row in the RLS isolation matrix for every new table
- [ ] No authoritative value writable by the client
- [ ] No secret, PII, or money amount in any log, breadcrumb, or analytics event
- [ ] Input validated at the client (Zod) **and** in the database (constraint/trigger/policy)

**Errors and validation**
- [ ] Every failure path maps to an `AppError` with a `userMessage` we wrote
- [ ] No raw `PostgrestError.message` can reach the DOM
- [ ] New constraints have a mapping entry (a test asserts none is missing)

**Tests**
- [ ] Unit tests for new domain functions, including the documented edge cases
- [ ] Integration test for a new table, policy, or RPC
- [ ] E2E spec if a critical flow changed
- [ ] Property test for new money or date logic
- [ ] A bug fix begins with a failing test named after the bug
- [ ] Coverage gates pass

**UI**
- [ ] Loading, empty, error, and loaded states all implemented
- [ ] Works at 360 px; touch targets ≥ 44 × 44 px
- [ ] Keyboard-navigable; labels present; `axe` clean; focus managed
- [ ] Respects `prefers-reduced-motion`
- [ ] Money rendered via `<Money>` with a spoken `aria-label`

**Process**
- [ ] Docs updated if a contract, schema, or decision changed
- [ ] ADR written if the decision was architectural
- [ ] Self-reviewed diff; PR under ~400 lines or split
- [ ] CI green; required approvals obtained

---

## 7. Code style

Prettier and ESLint decide formatting; do not argue with them in review. The rules worth stating
because a linter cannot enforce them:

- **Name the unit.** `amountMinor`, `limitMinor`, `daysRemaining`, `occurredOn` — never `amount`,
  `limit`, `days`, `date` on their own. Half of all money bugs are unit confusion wearing a
  plausible variable name.
- **One export per domain file**, named after the function. Grep should find it.
- **Return `Result`, do not throw**, for expected failures. Throw for programmer errors only.
- **Comments explain why.** The code already says what. A comment restating the line below it is
  noise that rots.
- **No barrel files** (`index.ts` re-exports) except at a layer boundary — they break tree-shaking
  and hide circular imports.

---

## 8. Getting help / escalation

| Situation | Do this |
|---|---|
| Unsure whether logic belongs in `domain/` | If it computes a number a user sees, it does. Ask in the PR if still unsure. |
| Need to change a merged migration | You don't. Write a new one. |
| Tempted to store a derived value | Read [DATABASE.md §8](./DATABASE.md), then justify it against the four-part denormalisation test in the PR description. |
| Tempted to add a dependency | Answer the five questions in [ARCHITECTURE.md §C](./ARCHITECTURE.md) in the PR: what, why needed, why this one, alternatives, tradeoffs. |
| A decision is being relitigated in PR comments | Write an ADR. A decision with an ADR is a decision; anything else is a preference. |
| Something feels architecturally wrong | Say so before building on it. The cheapest time to change the architecture is now. |
