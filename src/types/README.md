# `types/` — shared ambient types

Ambient declarations and types shared across more than one layer. Entity types are **not** here:
they live next to the code that owns them (`domain/` for domain entities, `data/supabase/
database.types.ts` for generated row types).

**Milestone 0 state:** `vite-env.d.ts` only.
