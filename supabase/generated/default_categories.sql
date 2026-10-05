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
  ('food', 'Food', 'expense', 'variable', 'utensils', 'orange', 1),
  ('transport', 'Transport', 'expense', 'variable', 'car', 'blue', 2),
  ('shopping', 'Shopping', 'expense', 'variable', 'shopping-bag', 'pink', 3),
  ('bills', 'Bills', 'expense', 'fixed', 'receipt', 'slate', 4),
  ('entertainment', 'Entertainment', 'expense', 'variable', 'clapperboard', 'purple', 5),
  ('healthcare', 'Healthcare', 'expense', 'variable', 'heart-pulse', 'red', 6),
  ('education', 'Education', 'expense', 'variable', 'graduation-cap', 'teal', 7),
  ('travel', 'Travel', 'expense', 'variable', 'plane', 'sky', 8),
  ('personal', 'Personal', 'expense', 'variable', 'user', 'amber', 9),
  ('other', 'Other', 'expense', 'variable', 'circle', 'neutral', 10),
  ('salary', 'Salary', 'income', 'variable', 'briefcase', 'green', 11),
  ('other_income', 'Other Income', 'income', 'variable', 'circle-plus', 'emerald', 12)
-- <<< END GENERATED DEFAULT CATEGORIES
