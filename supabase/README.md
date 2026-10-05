# `supabase/` — the backend

PostgreSQL **is** the backend ([ARCHITECTURE.md §A.3](../docs/ARCHITECTURE.md)): RLS policies are
the authorization layer, `CHECK` constraints and triggers are the validation layer, and
`SECURITY DEFINER` RPCs are the transactional service layer. There is no Node tier
([ADR-0004](../docs/adr/0004-no-node-api-tier.md)).

| Path          | Owns                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `config.toml` | Local stack configuration. Committed; it is part of the dev environment                             |
| `migrations/` | Timestamped, forward-only SQL. **A merged migration is never edited** — fix forward with a new file |
| `seed.sql`    | Local seed data, and the authoritative default-category list (see below)                            |
| `functions/`  | Edge Functions. The first, `delete-account`, lands in M1                                            |

The migration order is [DATABASE.md §13](../docs/DATABASE.md). Two rules make it work:

1. **Every migration applies to an empty database, in order.** CI runs `supabase db reset` on every
   pull request. A migration that only works against your local database is not a migration.
2. **Generated types are committed.** `npm run gen:types` output is checked in and CI fails on a
   diff, so a schema change with stale types cannot merge.

## The default-category list

`seed.sql` carries the twelve seeded categories between the `DEFAULT CATEGORIES` markers, and
`scripts/generate-category-constants.mjs` generates two artefacts from it. This exists because v1
kept the list in SQL _and_ in TypeScript and they drifted
([ARCHITECTURE.md §R.5](../docs/ARCHITECTURE.md), [ADR-0023](../docs/adr/0023-default-categories-generated-from-seed.md)).

| Generated                                   | For                             |
| ------------------------------------------- | ------------------------------- |
| `src/config/categories.generated.ts`        | the TypeScript layers           |
| `supabase/generated/default_categories.sql` | migrations, as a block to paste |

The SQL artefact exists because migrations are forward-only and immutable once merged (§13 rule 1),
so `handle_new_user()` cannot include a file that may change underneath it — it has to carry the
rows literally. **Milestone 1 pastes the generated block, markers included, and changes nothing
inside it.**

`npm run gen:categories -- --check` runs in CI and fails when either artefact is stale, when a
marked block inside `supabase/migrations/` differs from the generated fragment, or when a migration
writes its own category list at all. The copy is allowed; the drift is not.
