# ADR-0019 — Column-level `INSERT` grants for authoritative columns

Status: **Accepted** · Date: 2026-09-08 · Extends [ADR-0010](./0010-goal-progress-trigger-maintained.md)
and [ADR-0016](./0016-gamification-server-authoritative.md)

## Context

The design's most-repeated security claim is that a client cannot write an authoritative number:
`goals.saved_minor`, `goals.achieved_at`, `gamification_profiles.xp_total`, `categories.is_system`,
`transactions.status`. [DATABASE.md](../DATABASE.md) principle P2 states it as "tampering is
impossible, not merely discouraged", and [SECURITY.md §4.4](../SECURITY.md) calls the mechanism
"the single most important control in the gamification and goals design".

The mechanism was column-level `UPDATE` grants:

```sql
revoke update on public.goals from authenticated;
grant  update (name, target_minor, …) on public.goals to authenticated;
```

`INSERT` was granted table-wide in the same block: `grant select, insert, delete … to
authenticated`. A cross-document review found the consequence, and a spike confirmed it:

```sql
-- as `authenticated`, with a table-wide INSERT grant:
insert into public.goals (id, user_id, name, saved_minor, achieved_at)
values (…, 'Forged', 5000000, now());      -- succeeds
```

Nothing corrects it afterwards. `sync_goal_saved()` is a trigger on `goal_contributions`, so a goal
that is *born* with a fabricated total is never recomputed — unlike a tampered `UPDATE`, which the
grant rejects. The same shape applies to `categories.is_system` (forge an undeletable category) and
to `transactions.status`, `source`, `dedupe_hash` and `is_split`. A forged `is_split = true` with no
child rows is the worst of them: `enforce_split_total()` is a constraint trigger on
`transaction_splits`, so with zero children it never fires, and the row then joins
`transaction_category_amounts` carrying a `NULL` category — a wrong number in every breakdown.

## Decision

**Every authoritative column is absent from the `INSERT` grant as well as the `UPDATE` grant.**
Table-wide `GRANT INSERT` does not appear anywhere in the schema; every user-writable table gets an
explicit insert column list, mirroring its update column list plus the columns that are set once at
creation (`user_id`, `client_request_id`, `refund_of_transaction_id`).

```sql
revoke insert, update on public.goals from authenticated;
grant  insert (user_id, name, target_minor, currency_code, target_date,
               linked_account_id, priority) on public.goals to authenticated;
grant  update (name, target_minor, target_date, linked_account_id,
               priority, archived_at)       on public.goals to authenticated;
```

## Alternatives

1. **A `BEFORE INSERT` trigger** forcing authoritative columns to their defaults.
2. **Accept it** — a user forging their own goal balance only lies to themselves.
3. **Validate in the repository layer** (Zod `.strict()`, explicit column lists).

## Reasoning

Option 3 is already in place and is not a control: SECURITY.md §1's premise is that the client is a
hostile input source, and a `curl` with the user's own token bypasses the repository entirely.

Option 1 works, but it replaces a declarative privilege with procedural code that must be written
per table, can be dropped by a later migration, and is invisible in `information_schema`. A grant is
checked by PostgreSQL before RLS is consulted and is introspectable, which matters because the RLS
test matrix is generated.

Option 2 is defensible for `goals.saved_minor` alone — it is the user's own data and no decision of
ours depends on it. It is not defensible for `transactions.status` once ingestion exists (M12), where
`status='confirmed'` is the boundary between "a parser guessed this" and "a human confirmed it", nor
for `is_split`, which produces genuinely wrong category totals. And taking option 2 would require
rewriting P2, T4 and T6 to say something weaker — which is a decision that should be made in the
open, not by omitting half a grant.

Symmetry is the deciding argument: the control already exists, is already understood, and adding
the other half costs one line per table.

## Tradeoffs

- **A column added to a table and forgotten in the grant is unwritable.** This is the right failure
  direction — loud, immediate, and caught by the first integration test — but it will happen, and
  the error (`42501 permission denied for table x`) does not name the column. The RLS matrix row
  for each new table is what catches it before review.
- **Two grant lists per table to keep in step.** They are adjacent in the same migration.
- **`DEFAULT`s become load-bearing.** `saved_minor bigint not null default 0` is what makes a
  legitimate insert succeed while naming the column fails. Verified: a column absent from the
  insert grant still takes its default.

## Consequences

- No `grant insert` without a column list appears anywhere in `supabase/migrations/`.
- [SECURITY.md §8.1](../SECURITY.md) gains insert-side rows for every protected column, including
  the positive control that a legitimate insert still works and lands on the default.
- The Definition of Done in [CONTRIBUTING.md §6](../CONTRIBUTING.md) asks for both halves.
- `categories.slug` moves from "client-supplied" to trigger-derived (`set_category_slug()`), which
  is what [API.md §2.4](../API.md)'s `createCategory` input — which has no `slug` field — always
  implied.
