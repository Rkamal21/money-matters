# ADR-0023 — The default-category list lives in `seed.sql`, and everything else is generated from it

Status: **Accepted** · Date: 2026-09-09 · Resolves the contradiction between
[ARCHITECTURE.md §R.5](../ARCHITECTURE.md), [TESTING.md §4.4](../TESTING.md) and
[DATABASE.md §6.3](../DATABASE.md) · Implemented in Milestone 0

## Context

Three approved documents describe the twelve seeded categories, and they do not agree on where the
list lives.

- **[ARCHITECTURE.md §R.5](../ARCHITECTURE.md)** names category slugs as one of only three places
  business data was duplicated in v1 — "in seed SQL and in the TypeScript default list" — and
  resolves it: "making the SQL seed authoritative and generating the TS constants from it in CI".
- **[TESTING.md §4.4](../TESTING.md)** turns that into a CI assertion: "the category constants
  generated from `seed.sql` produce no diff against the committed TypeScript".
- **[DATABASE.md §6.3](../DATABASE.md)** says the rows are "inserted by `handle_new_user`" — a
  `SECURITY DEFINER` function that lives in a migration, not in `seed.sql`.

Taken together, the list would exist in `seed.sql` *and* in a migration, which is the duplication
§R.5 exists to remove — with the drift moved from TypeScript-versus-SQL to SQL-versus-SQL, where it
is harder to see. [ROADMAP.md](../ROADMAP.md) puts the generation step in Milestone 0 explicitly
"before there are two lists to drift", so the moment to settle this is now, not in M1.

The complication is [DATABASE.md §13](../DATABASE.md) rule 1: **a migration merged to `main` is
never edited.** That forbids the obvious fix. A migration cannot `\i` a shared file, or select from
a table that a later release might change, because either would silently alter what an already-run
migration means. A migration has to carry its data literally.

## Decision

**`supabase/seed.sql` holds the list, between the `DEFAULT CATEGORIES` markers. Nothing else
defines it; two artefacts are generated from it, and CI proves every copy still matches.**

`npm run gen:categories` writes:

| Artefact | Consumer |
|---|---|
| `src/config/categories.generated.ts` | the TypeScript layers |
| `supabase/generated/default_categories.sql` | migrations, as a block to paste |

`npm run gen:categories -- --check` — a CI job, and part of `npm run build` — fails when:

1. either generated artefact differs from what `seed.sql` produces; **or**
2. a file in `supabase/migrations/` contains a `GENERATED DEFAULT CATEGORIES` block whose rows
   differ from the generated fragment; **or**
3. a file in `supabase/migrations/` writes its own category list — three or more distinct default
   slugs as SQL string literals outside such a block.

Milestone 1's `handle_new_user()` migration pastes the generated block, markers included. **The copy
is allowed. The drift is not.**

## Alternatives

1. **A `public.default_categories()` set-returning function**, created in M0, that
   `handle_new_user()` selects from. Genuinely one list at runtime.
2. **Seed the rows from `seed.sql` into a reference table** and have the trigger read it.
3. **Leave it to M1**, as the Milestone 0 draft did, with the question recorded in `seed.sql`.
4. **Generate the migration file itself** from `seed.sql`.

## Reasoning

Option 1 is the tidiest-looking and was the first choice, but it fails on two counts. It invents a
function that no approved document describes, in a milestone whose database scope is "none"; and it
makes an immutable migration's behaviour depend on a function body that a later `CREATE OR REPLACE`
can change, which is rule 1 defeated by indirection rather than honoured.

Option 2 loses to [ADR-0008](./0008-per-user-seeded-categories.md) for the same reason shared system
rows lost: a table with no `user_id` forces every RLS policy, FK and join to special-case null
ownership, and the composite-FK technique in DATABASE.md §7 stops working. Twelve rows per signup
was already judged the cheaper trade.

Option 3 is what "before there are two lists to drift" was written to prevent. By M1 the second list
exists, and the fix competes with feature work.

Option 4 produces a *generated* file under `supabase/migrations/`, which is a direct contradiction
of rule 1 — regenerating rewrites a migration that has already run against real databases.

What is left is: accept that a forward-only migration must carry its data literally, and make the
literal copy verifiable instead of trusted. Check 3 is what makes this more than a convention —
it is not possible to add the list to a migration by hand without CI saying so, whether or not the
author knew this ADR existed.

Check 3 is a **heuristic**: "is this a category list" is not decidable, so the test is three or more
distinct default slugs as quoted literals outside a marked block. One slug in a comment or a `WHERE`
clause passes; three is a list. A false positive is silenced with the generated block or a rename;
the failure mode is a build that stops, not a rule that quietly does nothing.

## Tradeoffs

- **The rows exist twice on disk** — in `seed.sql` and in the M1 migration. That is the cost of
  forward-only migrations, and it is paid in bytes rather than in truth: the two cannot differ
  without CI failing.
- **Check 3 can fire on an innocent migration.** Any migration legitimately mentioning three default
  slugs must either use the generated block or be a reason to revisit the threshold.
- **A slug rename is a two-step change** — regenerate, then a new migration. It should be:
  renaming a slug after signup rows exist is a data migration, not an edit.
- **`icon` and `color` are the table defaults** (`'circle'`, `'neutral'`) for every seeded row.
  DATABASE.md §6.3 specifies the defaults but not per-category values, so nothing is invented here.
  Choosing real icons is a design task with no bearing on this decision.

## Consequences

- `supabase/seed.sql` carries the list and the note pointing here.
- `scripts/generate-category-constants.mjs` emits both artefacts and implements all three checks.
- `supabase/generated/` is committed. It is generated output, and it is in the repository because
  a migration author needs to paste from it without running a script first.
- The `lint` CI job runs `--check`; so does `npm run build`.
- **Milestone 1 owes nothing to this ADR except to paste the block.** It does not re-derive, re-type
  or re-order the list, and it does not need to know how the check works.
- ARCHITECTURE.md §R.5's third duplication is closed, in both directions rather than one.
