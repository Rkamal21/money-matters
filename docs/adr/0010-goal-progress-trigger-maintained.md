# ADR-0010 — Goal progress as a trigger-maintained cache over an append-only ledger

Status: **Superseded by [ADR-0026](./0026-goals-are-the-purpose-of-a-wallet.md)** · Date: 2026-09-07

> Superseded before implementation. The contribution ledger below was a second ledger beside
> `transactions`, so a goal could report money no account held. Goals now store no amount: each is
> backed by one wallet, and its progress is that wallet's balance. Kept for the reasoning about
> recompute-versus-increment, which still governs `gamification_profiles.xp_total`.

## Context

v1 stored `goals.current` as the only record of savings progress, and it was directly writable by
the browser: `supabase.from('goals').update({ current: 50000 })`. There was no record of *how* the
number got there, no way to audit it, and no way to repair it.

The brief requires a contribution ledger. The remaining question is whether progress is derived on
every read, cached, or materialised.

## Decision

`goal_contributions` is an append-only ledger and the **source of truth**. `goals.saved_minor` is a
cache, maintained by an `AFTER INSERT/UPDATE/DELETE` trigger that **recomputes** it as
`sum(amount_minor)` — never `saved_minor + delta`. The client has no `UPDATE` grant on the column.
`recompute_goal_totals()` is the documented recovery path.

## Alternatives

1. **Fully derived** — `SELECT sum(...)` on every read; no cached column.
2. **Materialised view** refreshed on a schedule.
3. **Incremental trigger** — `saved_minor = saved_minor + NEW.amount_minor`.
4. **Client-computed** from the contribution list.

## Reasoning

Option 1 is the purest and was the default choice. It was rejected on one concrete access pattern:
the goals list renders progress for every goal, so with 20 goals every render is 20 correlated
aggregates on a frequently-opened screen.

Option 2 introduces staleness into a number the user changes and immediately expects to see move.
Unacceptable for the "contribute ₹500" interaction.

Option 3 is the classic mistake. An incremental counter drifts: a missed trigger, a bulk operation,
a manual repair, and the number is quietly wrong forever with no way to detect it. **A recompute
cannot drift.** The performance difference is irrelevant — contributions are rare and the sum is
over a handful of rows behind an index.

Option 4 is v1's failure mode with extra steps.

## Tradeoffs

- **One denormalised column**, which is one thing that can be inconsistent. Bounded by: recompute
  not increment; same transaction as the write; a row lock; a CI test asserting equality after a
  randomised concurrent workload; and a repair function.
- **Trigger overhead** on every contribution write. Negligible at this rate.
- **Deleting a contribution is allowed** (users make mistakes) and correctly reduces the total,
  which means the ledger is append-mostly rather than strictly append-only. Deletions are audited.

## Consequences

- `goals` has no `status` column either: achieved and archived are derived from `saved_minor >=
  target_minor` and `archived_at`. Fewer stored facts, fewer disagreements.
- `add_goal_contribution` is an RPC so the insert, the recompute, the XP award, and the achievement
  check are one transaction. The XP award is available from Milestone 1, when the gamification
  schema and `award_xp()` are created; the achievement check joins in Milestone 9 with the catalog.
- `sync_goal_saved()` is `SECURITY DEFINER`. It writes `saved_minor` and `achieved_at`, which are
  revoked from `authenticated` — a plain trigger would run as the caller and fail `42501`, rolling
  back the contribution. See [ADR-0020](./0020-rls-execution-model.md).
- `saved_minor` is absent from the `INSERT` grant as well as the `UPDATE` grant
  ([ADR-0019](./0019-insert-column-grants.md)). Without that, a goal could be created with a
  fabricated total, and since this trigger fires on contributions rather than on `goals`, nothing
  would ever recompute it.
- The same pattern applies to `gamification_profiles.xp_total` over `gamification_events`
  (ADR-0016).
