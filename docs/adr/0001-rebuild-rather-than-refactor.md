# ADR-0001 — Rebuild v2 rather than refactor v1

Status: **Proposed** · Date: 2026-09-07

## Context

v1 is ~2,000 lines: React 19 + Vite in plain JavaScript, four Supabase tables, five hooks that each
talk to Supabase directly, and a 473-line `App.jsx` holding all routing, all state, and all
financial arithmetic. It works, and people have used it.

It also has structural defects that are not bugs to fix but shapes to replace: money as
`DECIMAL(10,2)` read into a JavaScript `Number`; no accounts, no income, no transfers; a single
budget row per user with no financial period; `goals.current` and `profiles.xp` writable directly
from the browser; `FOR ALL` RLS policies with no `WITH CHECK`; a category `CHECK` constraint that
turns "add a category" into a migration; and a UTC/local date confusion that put "today" on the
wrong day for 5½ hours of every Indian day.

## Decision

Start v2 from an empty `src/`. Treat v1 as reference material. Delete v1 source in Milestone 0.

## Alternatives

1. **Incremental refactor** — introduce TypeScript, extract a domain layer, migrate the schema in
   place while the app keeps running.
2. **Strangler pattern** — build v2 features alongside v1 behind flags, retiring v1 screens one by
   one.
3. **Keep the schema, rewrite the frontend** — on the theory that the schema is "close enough".

## Reasoning

The schema is the problem, not the frontend. Every table needs a different shape: `expenses` becomes
`transactions` with kinds and accounts; `budgets` gains a period; `goals` gains a ledger; `profiles`
loses its client-writable XP. Migrating four tables into fourteen, with different money types and
different ownership rules, is more work than writing fourteen — and it carries the risk of
half-migrated financial data, the worst available failure in this product.

The user base is small enough that a one-time export/import is tractable, and no external system
integrates with v1. The cost of the rebuild is bounded at ~2,000 lines; the cost of carrying the
schema forward is unbounded and compounds with every feature.

## Tradeoffs

- **Cost:** the working v1 app produces no new value during the rebuild. Mitigated by leaving v1
  deployed and untouched until v2 reaches Milestone 7.
- **Risk:** rebuilds famously over-scope. Mitigated by a strictly ordered roadmap in which the MVP
  is Milestone 7, not Milestone 13.
- **Loss:** v1's design language, splash screen, and nav icon set are genuinely good. They carry
  forward as design references, not as code.

## Consequences

- Milestone 0 deletes `src/**`, `supabase_schema.sql`, `dist/`, `updated_app.apk`, and the unused
  Android SMS code.
- A user-data migration script is needed only if v1 has real users worth migrating; it is a
  one-time export/transform/import written when needed, not designed for now.
- Nothing in v2 is shaped by v1 compatibility. That is the point.
