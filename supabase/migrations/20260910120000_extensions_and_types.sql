-- Extensions and enum types.
--
-- The first migration in DATABASE.md §13, transcribed from §5. It creates no
-- tables: Milestone 0's database scope is "CI database provisioning only"
-- (ROADMAP.md), and every table in §6 belongs to M1 or later. What it does
-- create is the ground every one of those migrations stands on, so that
-- `supabase db reset` from zero is a real check from the first PR rather than
-- something first exercised in M1.
--
-- Why enums here and a table for categories (§5): an enum value is coupled to
-- code — adding `transaction_kind = 'loan_repayment'` requires new branches in
-- the balance view, the analytics query and the domain layer, and the compiler
-- should stop you. A category is pure taxonomy; nothing branches on "Food" vs
-- "Groceries". Enums for the first, rows for the second.

create extension if not exists pgcrypto; -- gen_random_uuid()
create extension if not exists btree_gist; -- uuid = + daterange && in one EXCLUDE constraint
create extension if not exists pg_trgm; -- merchant/description search

create type public.account_type as enum ('cash', 'bank', 'savings', 'wallet', 'credit_card');

create type public.category_kind as enum ('expense', 'income');

create type public.category_treatment as enum ('fixed', 'variable', 'excluded');

create type public.transaction_kind as enum ('expense', 'income', 'transfer', 'refund');

create type public.transaction_source as enum (
  'manual',
  'sms',
  'import',
  'bank_sync',
  'recurring',
  'system'
);

create type public.transaction_status as enum (
  'detected',
  'pending_review',
  'confirmed',
  'rejected',
  'duplicate'
);

-- 'regex' is deliberately absent: ADR-0022.
create type public.match_type as enum ('contains', 'prefix', 'exact');

create type public.contribution_source as enum ('manual', 'transfer', 'auto_rule', 'system');

create type public.gamification_event_type as enum (
  'transaction_logged',
  'daily_check_in',
  'goal_contribution',
  'goal_achieved',
  'budget_reviewed',
  'period_under_budget',
  'achievement_unlocked',
  'adjustment'
);
