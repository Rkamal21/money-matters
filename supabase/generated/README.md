# `supabase/generated/` — generated SQL, committed on purpose

Everything here is written by `npm run gen:categories` from
[`supabase/seed.sql`](../seed.sql). **Do not edit these files.** The next
`npm run gen:categories -- --check` — a CI job, and part of `npm run build` — will fail.

It is committed rather than generated on demand because a migration author needs to paste from it,
and asking someone to run a script before they can write SQL is how a generated file quietly
becomes optional.

See [ADR-0023](../../docs/adr/0023-default-categories-generated-from-seed.md) for why the copy is
allowed and the drift is not.
