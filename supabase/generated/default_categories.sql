-- GENERATED FILE — DO NOT EDIT.
--
-- Source: supabase/seed.sql, between the DEFAULT CATEGORIES markers.
-- Regenerate: npm run gen:categories
-- Verified in CI: npm run gen:categories -- --check
--
-- Migrations are forward-only and immutable once merged (DATABASE.md §13), so a
-- migration cannot include a file that may change underneath it: it has to
-- carry these rows literally. Paste the marked block below, markers included,
-- into the migration that needs it — `handle_new_user()` in Milestone 1.
--
-- `--check` compares every marked block under supabase/migrations/ against
-- this file and fails on any difference, and refuses a migration that writes a
-- second, independent category list. The copy is allowed; drift is not.
-- See ADR-0023.
--
-- Columns are DATABASE.md §6.3:
--   (slug, name, kind, treatment, icon, color, position)

-- >>> BEGIN GENERATED DEFAULT CATEGORIES
  ('food', 'Food', 'expense', 'variable', 'circle', 'neutral', 1),
  ('transport', 'Transport', 'expense', 'variable', 'circle', 'neutral', 2),
  ('shopping', 'Shopping', 'expense', 'variable', 'circle', 'neutral', 3),
  ('bills', 'Bills', 'expense', 'fixed', 'circle', 'neutral', 4),
  ('entertainment', 'Entertainment', 'expense', 'variable', 'circle', 'neutral', 5),
  ('healthcare', 'Healthcare', 'expense', 'variable', 'circle', 'neutral', 6),
  ('education', 'Education', 'expense', 'variable', 'circle', 'neutral', 7),
  ('travel', 'Travel', 'expense', 'variable', 'circle', 'neutral', 8),
  ('personal', 'Personal', 'expense', 'variable', 'circle', 'neutral', 9),
  ('other', 'Other', 'expense', 'variable', 'circle', 'neutral', 10),
  ('salary', 'Salary', 'income', 'variable', 'circle', 'neutral', 11),
  ('other_income', 'Other Income', 'income', 'variable', 'circle', 'neutral', 12)
-- <<< END GENERATED DEFAULT CATEGORIES
