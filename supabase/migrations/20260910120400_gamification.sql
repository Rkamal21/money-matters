-- Gamification schema and `award_xp()` — DATABASE.md §6.9, ADR-0016.
--
-- The tables exist from Milestone 1 because `handle_new_user()` writes a
-- `gamification_profiles` row (ROADMAP.md, M1 note). The award triggers and
-- every product surface arrive later (20260910121500).
--
-- The client holds SELECT and nothing else on all four tables. XP is written
-- by `award_xp()` alone, which is SECURITY DEFINER, idempotent on
-- `(user_id, dedupe_key)`, and granted to nobody.

create table public.gamification_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  xp_total integer not null default 0
    constraint gamification_profiles_xp_check check (xp_total >= 0),
  current_streak integer not null default 0
    constraint gamification_profiles_streak_check check (current_streak >= 0),
  longest_streak integer not null default 0
    constraint gamification_profiles_longest_check check (longest_streak >= 0),
  last_check_in_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger gamification_profiles_set_updated_at
  before update on public.gamification_profiles
  for each row execute function public.set_updated_at();

create table public.gamification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type public.gamification_event_type not null,
  xp_awarded integer not null
    constraint gamification_events_xp_check check (xp_awarded >= 0),
  dedupe_key text not null
    constraint gamification_events_dedupe_length_check check (char_length(dedupe_key) <= 120),
  occurred_on date not null,
  context jsonb not null default '{}'::jsonb
    constraint gamification_events_context_size_check check (pg_column_size(context) < 1024),
  created_at timestamptz not null default now(),

  -- The whole anti-farming mechanism: a replay collides here and awards nothing.
  constraint gamification_events_dedupe_uk unique (user_id, dedupe_key)
);

create index gamification_events_user_time_idx on public.gamification_events (user_id, created_at desc);
create index gamification_events_cap_idx on public.gamification_events (user_id, type, occurred_on);

create table public.achievements (
  code text primary key
    constraint achievements_code_check check (code ~ '^[a-z0-9_]{1,40}$'),
  name text not null,
  description text not null,
  icon text not null default 'award',
  xp_reward integer not null default 0
    constraint achievements_xp_check check (xp_reward >= 0),
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_code text not null references public.achievements (code) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_code)
);

-- ---------------------------------------------------------------------------
-- RLS: read-only to the client. Every ✗ in SECURITY.md §4.3 is "no grant".
-- ---------------------------------------------------------------------------
alter table public.gamification_profiles enable row level security;
alter table public.gamification_profiles force row level security;
alter table public.gamification_events enable row level security;
alter table public.gamification_events force row level security;
alter table public.achievements enable row level security;
alter table public.achievements force row level security;
alter table public.user_achievements enable row level security;
alter table public.user_achievements force row level security;

revoke all on public.gamification_profiles from anon, authenticated;
revoke all on public.gamification_events from anon, authenticated;
revoke all on public.achievements from anon, authenticated;
revoke all on public.user_achievements from anon, authenticated;

grant select on public.gamification_profiles to authenticated;
grant select on public.gamification_events to authenticated;
grant select on public.achievements to authenticated;
grant select on public.user_achievements to authenticated;

create policy gamification_profiles_select on public.gamification_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy gamification_events_select on public.gamification_events
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy achievements_select on public.achievements
  for select to authenticated
  using (is_active);

create policy user_achievements_select on public.user_achievements
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- award_xp() — the ONLY writer of gamification_events and xp_total.
--
-- Takes a user id, which is safe only because nothing client-callable can
-- reach it: it carries no grant at all and is called from definer triggers
-- and RPCs that have already derived the user (SECURITY.md §4.5 rule 2).
--
--   * no-ops when the user has opted out (`gamification_enabled = false`)
--   * enforces the per-day caps from FINANCIAL-ENGINE.md §6
--   * idempotent on dedupe_key
--   * recomputes xp_total from the ledger rather than incrementing it, so the
--     one cache in the system cannot drift (ADR-0010's surviving reasoning)
-- ---------------------------------------------------------------------------
create or replace function public.award_xp(
  p_user_id uuid,
  p_type public.gamification_event_type,
  p_dedupe_key text,
  p_xp integer,
  p_occurred_on date,
  p_context jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_cap integer;
  v_count integer;
  v_inserted integer;
begin
  select p.gamification_enabled into v_enabled from public.profiles p where p.id = p_user_id;
  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  -- Serialise awards per user, so the cap count and the recompute are exact.
  perform 1 from public.gamification_profiles gp where gp.user_id = p_user_id for update;
  if not found then
    return 0;
  end if;

  v_cap := case p_type
    when 'transaction_logged' then 5
    when 'goal_contribution' then 10
    else null
  end;

  if v_cap is not null then
    select count(*) into v_count
      from public.gamification_events e
     where e.user_id = p_user_id and e.type = p_type and e.occurred_on = p_occurred_on;
    if v_count >= v_cap then
      return 0;
    end if;
  end if;

  insert into public.gamification_events (user_id, type, xp_awarded, dedupe_key, occurred_on, context)
  values (p_user_id, p_type, greatest(p_xp, 0), p_dedupe_key, p_occurred_on, coalesce(p_context, '{}'::jsonb))
  on conflict (user_id, dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return 0;
  end if;

  update public.gamification_profiles gp
     set xp_total = (
       select coalesce(sum(e.xp_awarded), 0)::integer
         from public.gamification_events e
        where e.user_id = p_user_id
     )
   where gp.user_id = p_user_id;

  return greatest(p_xp, 0);
end
$$;

revoke all on function public.award_xp(uuid, public.gamification_event_type, text, integer, date, jsonb)
  from public, anon, authenticated;
