# Architecture Decision Records

An ADR records a decision that a future developer would otherwise reverse by accident.

**The rule:** a decision with an ADR is a decision. Anything else is a preference, and preferences
lose arguments in PR comments six weeks later.

Each ADR has: **Context · Decision · Alternatives · Reasoning · Tradeoffs · Consequences**.
Status is `Proposed`, `Accepted`, `Superseded by NNNN`, or `Deprecated`. Accepted ADRs are not
edited; they are superseded by a new one that links back.

| # | Title | Status |
|---|---|---|
| [0001](./0001-rebuild-rather-than-refactor.md) | Rebuild v2 rather than refactor v1 | Proposed |
| [0002](./0002-typescript-strict.md) | TypeScript with `strict` everywhere | Proposed |
| [0003](./0003-supabase-as-backend.md) | Supabase as the backend; PostgreSQL as the application server | Proposed |
| [0004](./0004-no-node-api-tier.md) | No Node/Express API tier; Edge Functions only where a secret is needed | Proposed |
| [0005](./0005-money-as-bigint-minor-units.md) | Money as `bigint` minor units with an in-house `Money` type | Proposed |
| [0006](./0006-occurred-on-date-not-timestamptz.md) | `occurred_on date` + user timezone, not `timestamptz` | Proposed |
| [0007](./0007-calculations-in-ts-invariants-in-postgres.md) | Calculations in TypeScript, invariants in PostgreSQL | Proposed |
| [0008](./0008-per-user-seeded-categories.md) | Per-user seeded categories instead of shared system rows | Proposed |
| [0009](./0009-composite-foreign-keys.md) | Composite foreign keys `(id, user_id)` for cross-tenant integrity | Proposed |
| [0010](./0010-goal-progress-trigger-maintained.md) | Goal progress as a trigger-maintained cache over an append-only ledger | Superseded by [0026](./0026-goals-are-the-purpose-of-a-wallet.md) |
| [0011](./0011-react-router-over-tanstack-router.md) | React Router 7 over TanStack Router | Proposed |
| [0012](./0012-tanstack-query-only-state-library.md) | TanStack Query as the only state library at MVP | Proposed |
| [0013](./0013-trunk-based-branching.md) | Trunk-based branching now; `release/*` from Milestone 11 | Proposed |
| [0014](./0014-radix-primitives-vendored.md) | Radix primitives vendored, not a component library | Proposed |
| [0015](./0015-sms-ingestion-policy-gated.md) | SMS ingestion is optional and policy-gated; fallbacks ranked | Proposed |
| [0016](./0016-gamification-server-authoritative.md) | Gamification as an append-only event ledger, XP server-awarded only | Proposed |
| [0017](./0017-single-row-transfers-with-entry-view.md) | One transaction row per transfer, expanded by an `account_entries` view | Proposed |
| [0018](./0018-refunds-net-against-spend.md) | Refunds net against spending rather than counting as income | Proposed |
| [0019](./0019-insert-column-grants.md) | Column-level `INSERT` grants for authoritative columns | **Accepted** |
| [0020](./0020-rls-execution-model.md) | The RLS execution model: `FORCE`, `BYPASSRLS`, and trigger privileges | **Accepted** |
| [0021](./0021-safe-daily-limit-income-basis.md) | The safe daily limit uses `greater(planned, actual)` income | **Accepted** |
| [0022](./0022-drop-regex-match-type.md) | `regex` dropped from the merchant-rule `match_type` enum | **Accepted** |
| [0023](./0023-default-categories-generated-from-seed.md) | The default-category list lives in `seed.sql`; everything else is generated from it | **Accepted** |
| [0024](./0024-money-arithmetic-lint-is-a-heuristic.md) | The money-arithmetic lint rule is a name-matching guardrail, not financial analysis | **Accepted** |
| [0025](./0025-hosting-on-vercel.md) | Hosting on Vercel | **Accepted** |
| [0026](./0026-goals-are-the-purpose-of-a-wallet.md) | A goal is the purpose of a wallet; its progress is the wallet's ledger balance | **Accepted** |

## Writing a new one

Copy the shape of any file here. Number sequentially. Add a row above. Link it from the document it
affects. If you cannot fill in **Alternatives** with something you seriously considered, the
decision is probably not worth an ADR.
