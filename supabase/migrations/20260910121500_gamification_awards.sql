-- Gamification awards — the server half of Milestone 9. ADR-0016, ADR-0026.
--
-- The tables and `award_xp()` have existed since 20260910120400. This adds
-- everything that calls it:
--
--   on_transaction_awards_xp()   5 XP per transaction (5/day), or 15 for a
--                                transfer into a goal's wallet (10/day); and
--                                100 once when a goal's wallet first reaches
--                                its target
--   on_goal_awards_xp()          the same "reached" check when a goal is
--                                created over an already-full wallet
--   on_budget_reviewed()         5 XP once per period for revising the plan
--   daily_check_in(p_today)      the streak transition, server-side
--   evaluate_achievements(uid)   unlocks the catalog below
--   recompute_xp_totals(uid?)    the repair path for the one cache
--
-- There is no client-callable path that grants XP: every writer is a trigger
-- or a definer function that derives the user itself.
--
-- Award days are the user's civil day, computed from their stored timezone.
-- That day only decides the daily caps; it never decides which period a
-- transaction belongs to (that is always `occurred_on`).

-- ---------------------------------------------------------------------------
-- The catalog. Adding an achievement is a row here and a predicate in
-- evaluate_achievements() — never a schema change.
-- ---------------------------------------------------------------------------
insert into public.achievements (code, name, description, icon, xp_reward, sort_order) values
  ('first_transaction', 'First entry', 'Log your first transaction.', 'pen-line', 10, 1),
  ('budget_set', 'Planner', 'Set an expected income for a budget period.', 'calendar-check', 10, 2),
  ('first_goal', 'Goal setter', 'Create your first savings goal.', 'target', 10, 3),
  ('first_contribution', 'Paying yourself first', 'Move money into a goal''s wallet.', 'piggy-bank', 15, 4),
  ('streak_7', 'One-week streak', 'Check in seven days in a row.', 'flame', 25, 5),
  ('all_categories_used', 'The full picture', 'Record spending in every active expense category.', 'layout-grid', 25, 6),
  ('under_budget_month', 'Under budget', 'Finish a budget period with money to spare.', 'shield-check', 50, 7),
  ('saved_10k', 'First ten thousand', 'Hold ₹10,000 across your goal wallets.', 'landmark', 50, 8),
  ('goal_achieved', 'Goal reached', 'Reach the target of a savings goal.', 'trophy', 50, 9),
  ('streak_30', 'Thirty-day streak', 'Check in thirty days in a row.', 'flame', 100, 10);

-- The user's civil date, from the zone on their profile.
create or replace function public.user_today(p_user_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone p.timezone)::date from public.profiles p where p.id = p_user_id
$$;

revoke all on function public.user_today(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- evaluate_achievements(p_user_id) — internal. No grant: its only callers are
-- definer functions that have already derived the user (SECURITY.md §4.5).
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_achievements(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_today date;
  v_ach public.achievements;
  v_ok boolean;
  v_unlocked integer := 0;
begin
  select p.gamification_enabled, (now() at time zone p.timezone)::date
    into v_enabled, v_today
    from public.profiles p
   where p.id = p_user_id;
  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  for v_ach in
    select a.* from public.achievements a
     where a.is_active
       and not exists (
         select 1 from public.user_achievements u
          where u.user_id = p_user_id and u.achievement_code = a.code
       )
     order by a.sort_order
  loop
    v_ok := case v_ach.code
      when 'first_transaction' then exists (
        select 1 from public.transactions t
         where t.user_id = p_user_id and t.kind <> 'transfer'
           and t.deleted_at is null and t.status = 'confirmed')
      when 'budget_set' then exists (
        select 1 from public.budget_periods bp
         where bp.user_id = p_user_id and bp.expected_income_minor > 0)
      when 'first_goal' then exists (
        select 1 from public.goals g where g.user_id = p_user_id)
      when 'first_contribution' then exists (
        select 1 from public.transactions t
          join public.goals g on g.wallet_account_id = t.counter_account_id and g.user_id = t.user_id
         where t.user_id = p_user_id and t.kind = 'transfer'
           and t.deleted_at is null and t.status = 'confirmed')
      when 'streak_7' then exists (
        select 1 from public.gamification_profiles gp
         where gp.user_id = p_user_id and gp.longest_streak >= 7)
      when 'streak_30' then exists (
        select 1 from public.gamification_profiles gp
         where gp.user_id = p_user_id and gp.longest_streak >= 30)
      when 'all_categories_used' then
        exists (
          select 1 from public.categories c
           where c.user_id = p_user_id and c.kind = 'expense' and not c.is_archived)
        and not exists (
          select 1 from public.categories c
           where c.user_id = p_user_id and c.kind = 'expense' and not c.is_archived
             and not exists (
               select 1 from public.transaction_category_amounts a
                where a.user_id = p_user_id and a.category_id = c.id and a.kind = 'expense'))
      when 'under_budget_month' then exists (
        select 1 from public.gamification_events e
         where e.user_id = p_user_id and e.type = 'period_under_budget')
      when 'saved_10k' then coalesce((
        select sum(greatest(b.balance_minor, 0))
          from public.goals g
          join public.account_balances b on b.account_id = g.wallet_account_id
         where g.user_id = p_user_id), 0) >= 1000000
      when 'goal_achieved' then exists (
        select 1 from public.goal_progress gp where gp.user_id = p_user_id and gp.reached)
      else false
    end;

    if v_ok then
      insert into public.user_achievements (user_id, achievement_code)
      values (p_user_id, v_ach.code)
      on conflict do nothing;
      if found then
        perform public.award_xp(
          p_user_id, 'achievement_unlocked', 'ach:' || v_ach.code, v_ach.xp_reward, v_today,
          jsonb_build_object('code', v_ach.code)
        );
        v_unlocked := v_unlocked + 1;
      end if;
    end if;
  end loop;

  return v_unlocked;
end
$$;

revoke all on function public.evaluate_achievements(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- on_transaction_awards_xp() — AFTER INSERT, and AFTER UPDATE of the columns
-- that can move a wallet's balance.
-- ---------------------------------------------------------------------------
create or replace function public.on_transaction_awards_xp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_goal_id uuid;
  v_reached record;
begin
  if new.status <> 'confirmed' or new.deleted_at is not null then
    return null;
  end if;

  v_today := public.user_today(new.user_id);
  if v_today is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'transfer' then
      select g.id into v_goal_id
        from public.goals g
       where g.user_id = new.user_id and g.wallet_account_id = new.counter_account_id;
    end if;

    if v_goal_id is not null then
      perform public.award_xp(new.user_id, 'goal_contribution', 'contrib:' || new.id::text, 15, v_today,
                              jsonb_build_object('goal_id', v_goal_id));
    else
      perform public.award_xp(new.user_id, 'transaction_logged', 'tx:' || new.id::text, 5, v_today,
                              jsonb_build_object('kind', new.kind));
    end if;
  end if;

  -- The first transaction that takes a goal's wallet to its target awards
  -- goal_achieved, once ever (the dedupe key carries the goal id).
  for v_reached in
    select gp.goal_id
      from public.goal_progress gp
     where gp.user_id = new.user_id and gp.reached
       and (gp.wallet_account_id = new.account_id or gp.wallet_account_id = new.counter_account_id)
  loop
    perform public.award_xp(new.user_id, 'goal_achieved', 'goal:' || v_reached.goal_id::text, 100, v_today,
                            jsonb_build_object('goal_id', v_reached.goal_id));
  end loop;

  perform public.evaluate_achievements(new.user_id);
  return null;
end
$$;

revoke all on function public.on_transaction_awards_xp() from public, anon, authenticated;

create trigger transactions_award_xp
  after insert or update of amount_minor, kind, account_id, counter_account_id, occurred_on, deleted_at
  on public.transactions
  for each row execute function public.on_transaction_awards_xp();

-- ---------------------------------------------------------------------------
-- on_goal_awards_xp() — a goal created over a wallet that already holds the
-- target is reached from its first moment.
-- ---------------------------------------------------------------------------
create or replace function public.on_goal_awards_xp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  v_today := public.user_today(new.user_id);
  if v_today is null then
    return null;
  end if;

  if exists (select 1 from public.goal_progress gp where gp.goal_id = new.id and gp.reached) then
    perform public.award_xp(new.user_id, 'goal_achieved', 'goal:' || new.id::text, 100, v_today,
                            jsonb_build_object('goal_id', new.id));
  end if;

  perform public.evaluate_achievements(new.user_id);
  return null;
end
$$;

revoke all on function public.on_goal_awards_xp() from public, anon, authenticated;

create trigger goals_award_xp
  after insert or update of target_minor on public.goals
  for each row execute function public.on_goal_awards_xp();

-- ---------------------------------------------------------------------------
-- on_budget_reviewed() — revising a period's plan is worth 5 XP, once per period.
-- ---------------------------------------------------------------------------
create or replace function public.on_budget_reviewed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  if row(old.expected_income_minor, old.planned_fixed_minor, old.planned_savings_minor,
         old.overall_limit_minor, old.rollover_enabled)
     is not distinct from
     row(new.expected_income_minor, new.planned_fixed_minor, new.planned_savings_minor,
         new.overall_limit_minor, new.rollover_enabled) then
    return null;
  end if;

  v_today := public.user_today(new.user_id);
  if v_today is null then
    return null;
  end if;

  perform public.award_xp(new.user_id, 'budget_reviewed', 'review:' || lower(new.period)::text, 5, v_today,
                          jsonb_build_object('period_start', lower(new.period)));
  perform public.evaluate_achievements(new.user_id);
  return null;
end
$$;

revoke all on function public.on_budget_reviewed() from public, anon, authenticated;

create trigger budget_periods_reviewed
  after update of expected_income_minor, planned_fixed_minor, planned_savings_minor,
                  overall_limit_minor, rollover_enabled
  on public.budget_periods
  for each row execute function public.on_budget_reviewed();

-- ---------------------------------------------------------------------------
-- daily_check_in(p_today) — the streak transition, FINANCIAL-ENGINE.md §6.
--
--   last = null        → 1, first
--   last = today       → unchanged (ten check-ins in a day are one)
--   last = today − 1   → +1
--   last < today − 1   → reset to 1
--   last > today       → rejected: a clock running backwards is not a streak
--
-- p_today must sit within a day of the server date, so a manipulated device
-- clock cannot manufacture a streak (SECURITY.md T3).
-- ---------------------------------------------------------------------------
create or replace function public.daily_check_in(p_today date)
returns public.gamification_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean;
  v_gp public.gamification_profiles;
  v_streak integer;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_today is null or p_today < current_date - 1 or p_today > current_date + 1 then
    raise exception 'p_today is outside the accepted window' using errcode = '22007';
  end if;

  select * into v_gp from public.gamification_profiles gp where gp.user_id = v_user for update;
  if not found then
    raise exception 'gamification_profile_not_found' using errcode = 'P0002';
  end if;

  select p.gamification_enabled into v_enabled from public.profiles p where p.id = v_user;
  if not coalesce(v_enabled, false) then
    return v_gp;
  end if;

  if v_gp.last_check_in_on is not null and p_today < v_gp.last_check_in_on then
    raise exception 'check-in date is earlier than the last check-in' using errcode = '22007';
  end if;

  if v_gp.last_check_in_on = p_today then
    return v_gp;
  end if;

  v_streak := case
    when v_gp.last_check_in_on = p_today - 1 then v_gp.current_streak + 1
    else 1
  end;

  update public.gamification_profiles gp
     set current_streak = v_streak,
         longest_streak = greatest(gp.longest_streak, v_streak),
         last_check_in_on = p_today
   where gp.user_id = v_user;

  perform public.award_xp(v_user, 'daily_check_in', 'check_in:' || p_today::text, 10, p_today, '{}'::jsonb);
  perform public.evaluate_achievements(v_user);

  select * into v_gp from public.gamification_profiles gp where gp.user_id = v_user;
  return v_gp;
end
$$;

revoke all on function public.daily_check_in(date) from public, anon;
grant execute on function public.daily_check_in(date) to authenticated;

-- ---------------------------------------------------------------------------
-- recompute_xp_totals(p_user_id?) — maintenance. Rebuilds xp_total from the
-- event ledger. service_role only; never granted to authenticated, which is
-- why it may take a user id (API.md §4).
-- ---------------------------------------------------------------------------
create or replace function public.recompute_xp_totals(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.gamification_profiles gp
     set xp_total = coalesce((
       select sum(e.xp_awarded)::integer from public.gamification_events e where e.user_id = gp.user_id
     ), 0)
   where p_user_id is null or gp.user_id = p_user_id;

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.recompute_xp_totals(uuid) from public, anon, authenticated;
grant execute on function public.recompute_xp_totals(uuid) to service_role;
