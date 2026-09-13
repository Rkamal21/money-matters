-- The RPC surface. API.md §4, DATABASE.md §11.
--
-- Two kinds of function live here, and the difference is deliberate:
--
--   * Reads (`get_*`) are SECURITY INVOKER. RLS can express them, so RLS does
--     them (SECURITY.md §4.5 rule 5); they also filter on auth.uid() so the
--     planner uses the (user_id, …) indexes.
--   * Writes that touch a server-owned column (`ensure_budget_period`,
--     `replace_transaction_splits`, `delete_my_account`) are SECURITY DEFINER
--     with `search_path = ''`, derive the caller from auth.uid(), and give the
--     same error for "missing" and "not yours".
--
-- No client-callable function takes a user id (asserted in the schema suite).

-- ---------------------------------------------------------------------------
-- period_remaining_minor(period id) — internal.
--
-- What is left of a period's discretionary allowance: the numerator of the
-- safe daily limit, FINANCIAL-ENGINE.md §3.2 steps 4–9 with the default
-- `incomeBasis = 'greater'` (ADR-0021). Used here only for rollover and for
-- the "finished under budget" award at close; the live number on the
-- dashboard is computed in TypeScript by `domain/budget`, from the same
-- inputs, and the two are held together by an integration test.
-- ---------------------------------------------------------------------------
create or replace function public.period_remaining_minor(p_period_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.budget_periods;
  v_income bigint;
  v_fixed bigint;
  v_fixed_refund bigint;
  v_variable bigint;
  v_variable_refund bigint;
  v_available bigint;
begin
  select * into v_p from public.budget_periods where id = p_period_id;
  if not found then
    return 0;
  end if;

  select coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0),
         coalesce(sum(a.amount_minor) filter (where a.kind = 'expense' and c.treatment = 'fixed'), 0),
         coalesce(sum(a.amount_minor) filter (where a.kind = 'refund' and c.treatment = 'fixed'), 0),
         coalesce(sum(a.amount_minor) filter (where a.kind = 'expense' and c.treatment = 'variable'), 0),
         coalesce(sum(a.amount_minor) filter (where a.kind = 'refund' and c.treatment = 'variable'), 0)
    into v_income, v_fixed, v_fixed_refund, v_variable, v_variable_refund
    from public.transaction_category_amounts a
    join public.categories c on c.id = a.category_id and c.user_id = a.user_id
   where a.user_id = v_p.user_id
     and a.occurred_on >= lower(v_p.period) and a.occurred_on < upper(v_p.period);

  v_available := greatest(v_p.expected_income_minor, v_income)
               + v_p.rollover_in_minor
               - greatest(v_p.planned_fixed_minor, greatest(v_fixed - v_fixed_refund, 0))
               - v_p.planned_savings_minor;

  if v_p.overall_limit_minor is not null then
    v_available := least(v_available, v_p.overall_limit_minor);
  end if;

  return v_available - greatest(v_variable - v_variable_refund, 0);
end
$$;

revoke all on function public.period_remaining_minor(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ensure_budget_period(p_today) — idempotent; safe on every launch and from
-- two devices at once (DATABASE.md §12).
--
--   1. validates p_today against the server date (± one day covers every
--      real timezone; ARCHITECTURE.md §R.4)
--   2. closes every period that has ended, awarding "finished under budget"
--   3. returns the period containing p_today, creating it if missing, with the
--      previous period's plan, limits and (if enabled) rollover carried forward
-- ---------------------------------------------------------------------------
create or replace function public.ensure_budget_period(p_today date)
returns public.budget_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_start_day smallint;
  v_start date;
  v_end date;
  v_row public.budget_periods;
  v_prev public.budget_periods;
  v_closed public.budget_periods;
  v_rollover bigint := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_today is null or p_today < current_date - 1 or p_today > current_date + 1 then
    raise exception 'p_today is outside the accepted window' using errcode = '22007';
  end if;

  -- One writer per user at a time: the find-or-create below is then race-free.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('budget_period:' || v_user::text, 0));

  for v_closed in
    update public.budget_periods
       set closed_at = now()
     where user_id = v_user and closed_at is null and upper(period) <= p_today
    returning *
  loop
    if (v_closed.expected_income_minor > 0 or v_closed.overall_limit_minor is not null)
       and public.period_remaining_minor(v_closed.id) >= 0 then
      perform public.award_xp(
        v_user, 'period_under_budget', 'under:' || lower(v_closed.period)::text, 50, p_today,
        jsonb_build_object('period_start', lower(v_closed.period))
      );
    end if;
  end loop;

  select * into v_row from public.budget_periods where user_id = v_user and period @> p_today;
  if found then
    return v_row;
  end if;

  select p.budget_period_start_day into v_start_day from public.profiles p where p.id = v_user;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  v_start := make_date(extract(year from p_today)::int, extract(month from p_today)::int, v_start_day);
  if v_start > p_today then
    v_start := (v_start - interval '1 month')::date;
  end if;
  v_end := (v_start + interval '1 month')::date;

  -- Never overlap a neighbour, e.g. after the start day was changed mid-period.
  v_start := greatest(v_start, coalesce(
    (select max(upper(bp.period)) from public.budget_periods bp
      where bp.user_id = v_user and upper(bp.period) <= p_today), v_start));
  v_end := least(v_end, coalesce(
    (select min(lower(bp.period)) from public.budget_periods bp
      where bp.user_id = v_user and lower(bp.period) > p_today), v_end));

  select * into v_prev
    from public.budget_periods bp
   where bp.user_id = v_user and upper(bp.period) <= p_today
   order by upper(bp.period) desc
   limit 1;

  if v_prev.id is not null and v_prev.rollover_enabled then
    v_rollover := public.period_remaining_minor(v_prev.id);
  end if;

  insert into public.budget_periods (
    user_id, period, expected_income_minor, planned_fixed_minor, planned_savings_minor,
    overall_limit_minor, rollover_enabled, rollover_in_minor
  )
  values (
    v_user, daterange(v_start, v_end, '[)'),
    coalesce(v_prev.expected_income_minor, 0), coalesce(v_prev.planned_fixed_minor, 0),
    coalesce(v_prev.planned_savings_minor, 0), v_prev.overall_limit_minor,
    coalesce(v_prev.rollover_enabled, false),
    greatest(least(v_rollover, 899999999999999), -899999999999999)
  )
  on conflict do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.budget_periods where user_id = v_user and period @> p_today;
    return v_row;
  end if;

  if v_prev.id is not null then
    insert into public.budget_category_limits (user_id, budget_period_id, category_id, limit_minor, rollover_enabled)
    select v_user, v_row.id, l.category_id, l.limit_minor, l.rollover_enabled
      from public.budget_category_limits l
      join public.categories c on c.id = l.category_id
     where l.budget_period_id = v_prev.id and not c.is_archived;
  end if;

  return v_row;
end
$$;

revoke all on function public.ensure_budget_period(date) from public, anon;
grant execute on function public.ensure_budget_period(date) to authenticated;

-- ---------------------------------------------------------------------------
-- get_period_summary(p_from, p_to) — p_to is EXCLUSIVE, like every period end
-- in the system. Transfers are reported separately and excluded from income
-- and expense: moving ₹10,000 to savings never reads as spending.
-- ---------------------------------------------------------------------------
create or replace function public.get_period_summary(p_from date, p_to date)
returns table (
  income_minor bigint,
  expense_minor bigint,
  refund_minor bigint,
  fixed_minor bigint,
  fixed_refund_minor bigint,
  variable_minor bigint,
  variable_refund_minor bigint,
  excluded_minor bigint,
  excluded_refund_minor bigint,
  transfer_in_minor bigint,
  transfer_out_minor bigint,
  transaction_count integer,
  by_category jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 400 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  return query
  with amounts as (
    select a.transaction_id, a.kind, a.amount_minor, a.category_id,
           c.slug, c.name, c.kind as category_kind, c.treatment, c.icon, c.color
      from public.transaction_category_amounts a
      join public.categories c on c.id = a.category_id and c.user_id = a.user_id
     where a.user_id = v_user and a.occurred_on >= p_from and a.occurred_on < p_to
  ),
  per_category as (
    select am.category_id, am.slug, am.name, am.category_kind, am.treatment, am.icon, am.color,
           coalesce(sum(am.amount_minor) filter (where am.kind = 'expense'), 0)::bigint as expense_minor,
           coalesce(sum(am.amount_minor) filter (where am.kind = 'refund'), 0)::bigint as refund_minor,
           coalesce(sum(am.amount_minor) filter (where am.kind = 'income'), 0)::bigint as income_minor,
           count(distinct am.transaction_id)::int as txn_count
      from amounts am
     group by am.category_id, am.slug, am.name, am.category_kind, am.treatment, am.icon, am.color
  ),
  transfers as (
    select coalesce(sum(t.amount_minor), 0)::bigint as total
      from public.transactions t
     where t.user_id = v_user and t.kind = 'transfer'
       and t.deleted_at is null and t.status = 'confirmed'
       and t.occurred_on >= p_from and t.occurred_on < p_to
  )
  select
    coalesce(sum(pc.income_minor), 0)::bigint,
    coalesce(sum(pc.expense_minor), 0)::bigint,
    coalesce(sum(pc.refund_minor), 0)::bigint,
    coalesce(sum(pc.expense_minor) filter (where pc.treatment = 'fixed'), 0)::bigint,
    coalesce(sum(pc.refund_minor) filter (where pc.treatment = 'fixed'), 0)::bigint,
    coalesce(sum(pc.expense_minor) filter (where pc.treatment = 'variable'), 0)::bigint,
    coalesce(sum(pc.refund_minor) filter (where pc.treatment = 'variable'), 0)::bigint,
    coalesce(sum(pc.expense_minor) filter (where pc.treatment = 'excluded'), 0)::bigint,
    coalesce(sum(pc.refund_minor) filter (where pc.treatment = 'excluded'), 0)::bigint,
    (select tr.total from transfers tr),
    (select tr.total from transfers tr),
    (select count(distinct am.transaction_id)::int from amounts am),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category_id', pc.category_id, 'slug', pc.slug, 'name', pc.name,
          'kind', pc.category_kind, 'treatment', pc.treatment, 'icon', pc.icon, 'color', pc.color,
          'expense_minor', pc.expense_minor, 'refund_minor', pc.refund_minor,
          'income_minor', pc.income_minor, 'txn_count', pc.txn_count
        )
        order by pc.expense_minor desc, pc.income_minor desc, pc.name
      ) filter (where pc.category_id is not null),
      '[]'::jsonb
    )
  from per_category pc;
end
$$;

revoke all on function public.get_period_summary(date, date) from public, anon;
grant execute on function public.get_period_summary(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- get_spending_over_time(p_from, p_to, granularity) — zero-filled, so a day
-- with no spending renders as ₹0 rather than as a gap (FINANCIAL-ENGINE.md §7).
-- Categories treated as `excluded` are left out, as they are from budgets.
-- ---------------------------------------------------------------------------
create or replace function public.get_spending_over_time(
  p_from date,
  p_to date,
  p_granularity text default 'day'
)
returns table (bucket date, expense_minor bigint, refund_minor bigint, income_minor bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_max integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_granularity is null or p_granularity not in ('day', 'week', 'month') then
    raise exception 'granularity must be day, week or month' using errcode = '22023';
  end if;
  v_max := case p_granularity when 'day' then 400 when 'week' then 800 else 3700 end;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > v_max then
    raise exception 'invalid date range' using errcode = '22023';
  end if;

  return query
  with buckets as (
    select g::date as bucket
      from generate_series(
        date_trunc(p_granularity, p_from::timestamp),
        (p_to - 1)::timestamp,
        ('1 ' || p_granularity)::interval
      ) g
  ),
  agg as (
    select date_trunc(p_granularity, a.occurred_on::timestamp)::date as bucket,
           coalesce(sum(a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as expense_minor,
           coalesce(sum(a.amount_minor) filter (where a.kind = 'refund'), 0)::bigint as refund_minor,
           coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as income_minor
      from public.transaction_category_amounts a
      join public.categories c on c.id = a.category_id and c.user_id = a.user_id
     where a.user_id = v_user and a.occurred_on >= p_from and a.occurred_on < p_to
       and c.treatment <> 'excluded'
     group by 1
  )
  select b.bucket,
         coalesce(g.expense_minor, 0)::bigint,
         coalesce(g.refund_minor, 0)::bigint,
         coalesce(g.income_minor, 0)::bigint
    from buckets b
    left join agg g on g.bucket = b.bucket
   order by b.bucket;
end
$$;

revoke all on function public.get_spending_over_time(date, date, text) from public, anon;
grant execute on function public.get_spending_over_time(date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_monthly_comparison(p_today, p_months) — the user's last N financial
-- months (anchored on budget_period_start_day), oldest first, each summarised.
-- ---------------------------------------------------------------------------
create or replace function public.get_monthly_comparison(p_today date, p_months integer default 6)
returns table (
  period_start date,
  period_end date,
  income_minor bigint,
  expense_minor bigint,
  refund_minor bigint,
  fixed_minor bigint,
  variable_minor bigint,
  variable_refund_minor bigint,
  excluded_minor bigint,
  planned_income_minor bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_start_day smallint;
  v_current_start date;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_today is null or p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'invalid arguments' using errcode = '22023';
  end if;

  select p.budget_period_start_day into v_start_day from public.profiles p where p.id = v_user;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  v_current_start := make_date(extract(year from p_today)::int, extract(month from p_today)::int, v_start_day);
  if v_current_start > p_today then
    v_current_start := (v_current_start - interval '1 month')::date;
  end if;

  return query
  select s.ps,
         s.pe,
         sm.income_minor,
         sm.expense_minor,
         sm.refund_minor,
         sm.fixed_minor,
         sm.variable_minor,
         sm.variable_refund_minor,
         sm.excluded_minor,
         (select bp.expected_income_minor from public.budget_periods bp
           where bp.user_id = v_user and bp.period @> s.ps limit 1)
    from (
      select (v_current_start - make_interval(months => i))::date as ps,
             (v_current_start - make_interval(months => i - 1))::date as pe
        from generate_series(0, p_months - 1) as i
    ) s
    cross join lateral public.get_period_summary(s.ps, s.pe) sm
   order by s.ps;
end
$$;

revoke all on function public.get_monthly_comparison(date, integer) from public, anon;
grant execute on function public.get_monthly_comparison(date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- get_dashboard_snapshot(p_today) — one round trip for the whole dashboard
-- (DATABASE.md §11). Returns jsonb, so the client validates its shape with Zod
-- like any other untrusted input (API.md §4).
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_snapshot(p_today date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_period public.budget_periods;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_today is null then
    raise exception 'p_today is required' using errcode = '22023';
  end if;

  select * into v_period from public.budget_periods bp where bp.user_id = v_user and bp.period @> p_today;

  select jsonb_build_object(
    'today', p_today,
    'period', case when v_period.id is null then null else jsonb_build_object(
      'id', v_period.id,
      'start', lower(v_period.period),
      'end_exclusive', upper(v_period.period),
      'expected_income_minor', v_period.expected_income_minor,
      'planned_fixed_minor', v_period.planned_fixed_minor,
      'planned_savings_minor', v_period.planned_savings_minor,
      'overall_limit_minor', v_period.overall_limit_minor,
      'rollover_enabled', v_period.rollover_enabled,
      'rollover_in_minor', v_period.rollover_in_minor,
      'closed_at', v_period.closed_at,
      'updated_at', v_period.updated_at
    ) end,
    'summary', case when v_period.id is null then null else (
      select to_jsonb(s) from public.get_period_summary(lower(v_period.period), upper(v_period.period)) s
    ) end,
    'today_summary', (
      select to_jsonb(s) - 'by_category' from public.get_period_summary(p_today, p_today + 1) s
    ),
    'category_limits', coalesce((
      select jsonb_agg(jsonb_build_object('category_id', l.category_id, 'limit_minor', l.limit_minor))
        from public.budget_category_limits l
       where l.user_id = v_user and l.budget_period_id = v_period.id
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'name', a.name, 'type', a.type, 'currency_code', a.currency_code,
               'balance_minor', b.balance_minor, 'credit_limit_minor', a.credit_limit_minor,
               'is_archived', a.is_archived
             ) order by a.position, a.name)
        from public.accounts a
        join public.account_balances b on b.account_id = a.id
       where a.user_id = v_user and not a.is_archived
    ), '[]'::jsonb),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name, 'target_minor', g.target_minor,
               'target_date', g.target_date, 'wallet_account_id', g.wallet_account_id,
               'balance_minor', gp.balance_minor, 'reached', gp.reached, 'reached_on', gp.reached_on,
               'currency_code', gp.currency_code
             ) order by g.priority, g.created_at)
        from public.goals g
        join public.goal_progress gp on gp.goal_id = g.id
       where g.user_id = v_user and g.archived_at is null
    ), '[]'::jsonb),
    'recent_transactions', coalesce((
      select jsonb_agg(r.row order by r.occurred_on desc, r.created_at desc)
        from (
          select t.occurred_on, t.created_at, jsonb_build_object(
                   'id', t.id, 'kind', t.kind, 'amount_minor', t.amount_minor,
                   'currency_code', t.currency_code, 'occurred_on', t.occurred_on,
                   'description', t.description, 'merchant_label', t.merchant_label,
                   'is_split', t.is_split,
                   'category_name', c.name, 'category_icon', c.icon, 'category_color', c.color,
                   'account_name', a.name, 'counter_account_name', ca.name
                 ) as row
            from public.transactions t
            join public.accounts a on a.id = t.account_id
            left join public.accounts ca on ca.id = t.counter_account_id
            left join public.categories c on c.id = t.category_id
           where t.user_id = v_user and t.deleted_at is null and t.status = 'confirmed'
           order by t.occurred_on desc, t.created_at desc
           limit 6
        ) r
    ), '[]'::jsonb),
    'gamification', (
      select to_jsonb(gp) - 'user_id' - 'created_at' - 'updated_at'
        from public.gamification_profiles gp
       where gp.user_id = v_user
    )
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.get_dashboard_snapshot(date) from public, anon;
grant execute on function public.get_dashboard_snapshot(date) to authenticated;

-- ---------------------------------------------------------------------------
-- replace_transaction_splits(tx, parts, category) — swap a transaction's parts
-- atomically. An empty array un-splits it back onto `p_category_id`.
-- The deferred constraint trigger re-validates the result at commit.
-- ---------------------------------------------------------------------------
create or replace function public.replace_transaction_splits(
  p_transaction_id uuid,
  p_splits jsonb,
  p_category_id uuid default null
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tx public.transactions;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_splits is null or jsonb_typeof(p_splits) <> 'array' then
    raise exception 'p_splits must be an array' using errcode = '22023';
  end if;

  select * into v_tx
    from public.transactions t
   where t.id = p_transaction_id and t.user_id = v_user and t.deleted_at is null
     for update;
  if not found then
    -- The same error whether the row is missing or someone else's (SECURITY.md §4.5 rule 4).
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;

  if v_tx.kind = 'transfer' then
    raise exception 'a transfer cannot be split'
      using errcode = '23514', constraint = 'tx_transfer_not_split';
  end if;

  delete from public.transaction_splits s where s.transaction_id = v_tx.id;

  if jsonb_array_length(p_splits) = 0 then
    if p_category_id is null then
      raise exception 'a category is required to un-split a transaction' using errcode = '22023';
    end if;
    update public.transactions t
       set is_split = false, category_id = p_category_id
     where t.id = v_tx.id
    returning * into v_tx;
    return v_tx;
  end if;

  insert into public.transaction_splits (user_id, transaction_id, category_id, amount_minor, note)
  select v_user, v_tx.id, (e ->> 'category_id')::uuid, (e ->> 'amount_minor')::bigint,
         nullif(btrim(coalesce(e ->> 'note', '')), '')
    from jsonb_array_elements(p_splits) as e;

  update public.transactions t
     set is_split = true, category_id = null
   where t.id = v_tx.id
  returning * into v_tx;

  return v_tx;
end
$$;

revoke all on function public.replace_transaction_splits(uuid, jsonb, uuid) from public, anon;
grant execute on function public.replace_transaction_splits(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_my_account() — removes the caller's auth user; every application row
-- goes with it through ON DELETE CASCADE (SECURITY.md §3).
--
-- DATABASE.md §11 sketches this as an Edge Function holding service_role. A
-- definer function owned by `postgres` can delete from auth.users directly,
-- derives the caller from the JWT exactly as the Edge Function would, and
-- keeps service_role out of one more place.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from auth.users u where u.id = v_user;
end
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
