-- Profiles, and the two helpers every later table leans on.
--
-- DATABASE.md §6.1 and §10. One row per auth user, created by
-- `handle_new_user()` (20260910120500), never by the client: `authenticated`
-- holds no INSERT or DELETE grant here, only SELECT and a column-scoped UPDATE.

-- ---------------------------------------------------------------------------
-- set_updated_at() — BEFORE UPDATE on every table with an `updated_at`.
-- Assigns NEW only, so it needs no column privilege and stays invoker.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- is_valid_timezone(text) — used by the CHECK on profiles.timezone.
-- Declared IMMUTABLE so a CHECK may call it; the zone database only changes
-- with a PostgreSQL upgrade, which is the accepted cost of that declaration.
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_timezone(p_tz text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz)
$$;

revoke all on function public.is_valid_timezone(text) from public, anon;
grant execute on function public.is_valid_timezone(text) to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default ''
    constraint profiles_display_name_length_check check (char_length(display_name) <= 80),
  timezone text not null default 'Asia/Kolkata'
    constraint profiles_timezone_valid_check check (public.is_valid_timezone(timezone)),
  currency_code char(3) not null default 'INR'
    constraint profiles_currency_code_check check (currency_code ~ '^[A-Z]{3}$'),
  locale text not null default 'en-IN'
    constraint profiles_locale_check check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  -- Capped at 28 so every month contains the day (FINANCIAL-ENGINE.md §2.2).
  budget_period_start_day smallint not null default 1
    constraint profiles_start_day_range_check check (budget_period_start_day between 1 and 28),
  onboarding_completed_at timestamptz,
  onboarding_version smallint not null default 1,
  gamification_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, timezone, currency_code, locale, budget_period_start_day,
              onboarding_completed_at, gamification_enabled)
  on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
