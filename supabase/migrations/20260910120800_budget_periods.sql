-- Budget periods and per-category limits. DATABASE.md §6.6 and §6.7.
--
-- One row per user per financial period, so September and August are two
-- facts rather than one row overwritten (v1's F6). The EXCLUDE constraint is
-- the guarantee that "which period is today in?" has exactly one answer.
--
-- Closed periods are history: readable, never writable (SECURITY.md §4.3).
-- `closed_at` and `rollover_in_minor` are server-owned — written only by
-- `ensure_budget_period()` — and appear in no client grant.

create table public.budget_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period daterange not null,
  expected_income_minor bigint not null default 0,
  planned_fixed_minor bigint not null default 0,
  planned_savings_minor bigint not null default 0,
  overall_limit_minor bigint,
  rollover_enabled boolean not null default false,
  rollover_in_minor bigint not null default 0,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint budget_periods_shape_check check (
    lower_inc(period) and not upper_inc(period) and not isempty(period)
    and not lower_inf(period) and not upper_inf(period)
  ),
  constraint budget_periods_amounts_check check (
    expected_income_minor >= 0 and expected_income_minor < 900000000000000
    and planned_fixed_minor >= 0 and planned_fixed_minor < 900000000000000
    and planned_savings_minor >= 0 and planned_savings_minor < 900000000000000
    and (overall_limit_minor is null
         or (overall_limit_minor >= 0 and overall_limit_minor < 900000000000000))
  ),
  constraint budget_periods_rollover_range_check check (
    rollover_in_minor > -900000000000000 and rollover_in_minor < 900000000000000
  ),
  constraint budget_periods_id_user_uk unique (id, user_id),
  constraint budget_periods_no_overlap exclude using gist (user_id with =, period with &&)
);

create trigger budget_periods_set_updated_at
  before update on public.budget_periods
  for each row execute function public.set_updated_at();

alter table public.budget_periods enable row level security;
alter table public.budget_periods force row level security;

revoke all on public.budget_periods from anon, authenticated;
grant select, delete on public.budget_periods to authenticated;
grant insert (user_id, period, expected_income_minor, planned_fixed_minor, planned_savings_minor,
              overall_limit_minor, rollover_enabled)
  on public.budget_periods to authenticated;
grant update (expected_income_minor, planned_fixed_minor, planned_savings_minor,
              overall_limit_minor, rollover_enabled)
  on public.budget_periods to authenticated;

create policy budget_periods_select on public.budget_periods
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy budget_periods_insert on public.budget_periods
  for insert to authenticated
  with check (user_id = (select auth.uid()) and closed_at is null);

create policy budget_periods_update on public.budget_periods
  for update to authenticated
  using (user_id = (select auth.uid()) and closed_at is null)
  with check (user_id = (select auth.uid()) and closed_at is null);

create policy budget_periods_delete on public.budget_periods
  for delete to authenticated
  using (user_id = (select auth.uid()) and closed_at is null);

-- ---------------------------------------------------------------------------
-- budget_category_limits
-- ---------------------------------------------------------------------------
create table public.budget_category_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  budget_period_id uuid not null,
  category_id uuid not null,
  limit_minor bigint not null
    constraint bcl_limit_range_check check (limit_minor >= 0 and limit_minor < 900000000000000),
  rollover_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bcl_id_user_uk unique (id, user_id),
  constraint bcl_period_category_uk unique (budget_period_id, category_id),
  constraint bcl_period_fk foreign key (budget_period_id, user_id)
    references public.budget_periods (id, user_id) on delete cascade,
  constraint bcl_category_fk foreign key (category_id, user_id)
    references public.categories (id, user_id)
);

create index bcl_period_idx on public.budget_category_limits (user_id, budget_period_id);

create trigger budget_category_limits_set_updated_at
  before update on public.budget_category_limits
  for each row execute function public.set_updated_at();

alter table public.budget_category_limits enable row level security;
alter table public.budget_category_limits force row level security;

revoke all on public.budget_category_limits from anon, authenticated;
grant select, delete on public.budget_category_limits to authenticated;
grant insert (user_id, budget_period_id, category_id, limit_minor, rollover_enabled)
  on public.budget_category_limits to authenticated;
grant update (limit_minor, rollover_enabled)
  on public.budget_category_limits to authenticated;

-- A limit is writable only while its period is open. The subquery reads the
-- caller's own period row, never another user's table.
create policy budget_category_limits_select on public.budget_category_limits
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy budget_category_limits_insert on public.budget_category_limits
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.budget_periods p
       where p.id = budget_period_id and p.user_id = (select auth.uid()) and p.closed_at is null
    )
  );

create policy budget_category_limits_update on public.budget_category_limits
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.budget_periods p
       where p.id = budget_period_id and p.user_id = (select auth.uid()) and p.closed_at is null
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.budget_periods p
       where p.id = budget_period_id and p.user_id = (select auth.uid()) and p.closed_at is null
    )
  );

create policy budget_category_limits_delete on public.budget_category_limits
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.budget_periods p
       where p.id = budget_period_id and p.user_id = (select auth.uid()) and p.closed_at is null
    )
  );
