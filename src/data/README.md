# `data/` — data access

The only place that knows Supabase exists. `import { supabase }` appears in `data/supabase/` and
nowhere else; every other layer talks to a repository interface
([ADR-0003](../../docs/adr/0003-supabase-as-backend.md), [ARCHITECTURE.md §G.1](../../docs/ARCHITECTURE.md)).

- `supabase/` — the client, the generated `database.types.ts`, and `PostgrestError → AppError` mapping.
- `repositories/` — one interface + one Supabase implementation per entity.
  [API.md §3](../../docs/API.md) owns the signatures; they are not restated here.
- `mappers/` — row ⇄ domain entity. **This is where `bigint` becomes `Money`**, which is what makes
  "no float arithmetic on money" structurally true rather than a guideline.

**Milestone 0 state:** `supabase/env.ts` validates the connection settings; the client itself, the
generated types and the first repositories land in M1 alongside the first tables.
