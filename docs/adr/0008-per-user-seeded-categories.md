# ADR-0008 — Per-user seeded categories instead of shared system rows

Status: **Proposed** · Date: 2026-09-07

## Context

Every user needs the same ten or so default categories. v1 hard-coded them in a `CHECK` constraint,
which made adding a user category a database migration. The obvious fix is a `categories` table —
but then: are the defaults shared rows with `user_id IS NULL`, or copies per user?

## Decision

Copy them. On signup, `handle_new_user()` inserts twelve rows owned by the new user, flagged
`is_system = true`. There are no shared category rows.

## Alternatives

1. **Shared system rows** with `user_id IS NULL`, plus user rows alongside.
2. **A separate `system_categories` table** joined at read time.
3. **Hard-coded defaults in the client**, with only user-created categories in the database.

## Reasoning

Shared rows break three things at once:

- **RLS** becomes `user_id IS NULL OR user_id = auth.uid()` on every category policy, and every
  policy that joins categories inherits the special case.
- **Composite foreign keys stop working.** `(category_id, user_id) → categories (id, user_id)`
  cannot match a row whose `user_id` is null, so the cross-tenant integrity mechanism in ADR-0009 —
  the strongest control in the schema — is unavailable for the most-referenced table in the system.
- **Renaming.** "Food" → "Eating out" on a shared row is impossible, so it needs an override table,
  which is a per-user copy wearing a disguise.

Option 3 puts a business concept in the client and makes historical categories unresolvable after a
default changes.

The cost of copying is twelve rows per signup. At 100,000 users that is 1.2 million rows in a table
with a two-column index — trivial for PostgreSQL, and each user's slice is what their queries touch.

## Tradeoffs

- **Changing a default does not reach existing users.** Correct behaviour: their categories are
  theirs. New defaults arrive for new users, and a one-off migration can offer additions if we ever
  want them.
- **Slightly slower signup** — one extra multi-row insert inside a transaction that already exists.
- **`is_system` needs protecting** so a client cannot forge or clear it: excluded from the UPDATE
  grant, and a `BEFORE DELETE` trigger prevents deletion.

## Consequences

- `categories.slug` is the stable machine key that merchant rules and seeds bind to; `name` is free
  to change.
- Merchant rules reference `category_slug`, not `category_id`, so a shared system rule resolves per
  user (see DATABASE.md §6.10).
- Signup is one transaction creating profile + gamification profile + twelve categories, or none.
