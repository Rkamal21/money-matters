-- Local development seed data, and the authoritative default-category list.
--
-- Run by `supabase db reset` after every migration has applied.
--
-- ============================================================================
-- Default categories — SINGLE SOURCE OF TRUTH
-- ============================================================================
-- ARCHITECTURE.md §R.5 names category slugs as the one place business data was
-- duplicated in v1 (SQL seed *and* a TypeScript list), and resolves it by
-- making the SQL seed authoritative and generating the TypeScript from it.
-- TESTING.md §4.4 turns that into a CI check: "the category constants generated
-- from seed.sql produce no diff against the committed TypeScript".
--
-- So this block is the list. `scripts/generate-category-constants.mjs` parses
-- the rows between the BEGIN and END markers and writes
-- `src/config/categories.generated.ts`. Editing that file by hand is pointless;
-- editing this block is how the list changes.
--
-- Column meanings are DATABASE.md §6.3. `icon` and `color` are the table
-- defaults ('circle', 'neutral') for every seeded row — §6.3 specifies the
-- defaults but not per-category values, so nothing is invented here.
-- Treatment follows §6.3 exactly: every expense category is 'variable' except
-- `bills`, which is 'fixed'.
--
-- >>> BEGIN DEFAULT CATEGORIES
--   (slug,           name,           kind,      treatment,  icon,     color,     position)
--   ('food',          'Food',          'expense', 'variable', 'circle', 'neutral',  1),
--   ('transport',     'Transport',     'expense', 'variable', 'circle', 'neutral',  2),
--   ('shopping',      'Shopping',      'expense', 'variable', 'circle', 'neutral',  3),
--   ('bills',         'Bills',         'expense', 'fixed',    'circle', 'neutral',  4),
--   ('entertainment', 'Entertainment', 'expense', 'variable', 'circle', 'neutral',  5),
--   ('healthcare',    'Healthcare',    'expense', 'variable', 'circle', 'neutral',  6),
--   ('education',     'Education',     'expense', 'variable', 'circle', 'neutral',  7),
--   ('travel',        'Travel',        'expense', 'variable', 'circle', 'neutral',  8),
--   ('personal',      'Personal',      'expense', 'variable', 'circle', 'neutral',  9),
--   ('other',         'Other',         'expense', 'variable', 'circle', 'neutral', 10),
--   ('salary',        'Salary',        'income',  'variable', 'circle', 'neutral', 11),
--   ('other_income',  'Other Income',  'income',  'variable', 'circle', 'neutral', 12)
-- <<< END DEFAULT CATEGORIES
--
-- How Milestone 1 uses this list (ADR-0023):
-- DATABASE.md §6.3 has `handle_new_user()` insert these rows, and that lives in
-- a migration. Migrations are forward-only and immutable once merged
-- (DATABASE.md §13 rule 1), so the trigger cannot include a file that may
-- change underneath it — it has to carry the rows literally.
--
-- So the copy is allowed and the drift is not. `npm run gen:categories` writes
-- the canonical SQL rows to `supabase/generated/default_categories.sql`; M1
-- pastes that marked block into the `handle_new_user()` migration; and
-- `gen:categories --check` — a CI job — fails if any marked block in
-- `supabase/migrations/` differs from it, or if a migration writes its own
-- category list at all. There is one list, and it is the one above.

-- ============================================================================
-- Seed data
-- ============================================================================
-- Nothing to insert yet: Milestone 0 creates extensions and enum types only,
-- and every table lands in M1 or later (ROADMAP.md — "Database: none").
-- Development fixtures arrive with the tables that hold them.

do $$
begin
  raise notice 'Milestone 0: no tables to seed yet. Extensions and enum types applied.';
end
$$;
