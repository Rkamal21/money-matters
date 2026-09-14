-- Goals: the purpose of a wallet. DATABASE.md §6.8, ADR-0026.
--
-- A goal holds no money and stores no amount saved. Its progress IS its
-- wallet's balance, read from `goal_progress` (20260910121100). Contributing
-- is a transfer into the wallet; withdrawing is a transfer out.
--
-- The type-pinned composite foreign key carries both "is yours" and "is a
-- wallet": pointing a goal at a bank account, at another user's wallet, or
-- retyping a wallet that backs a goal are all 23503 at the storage layer.

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  wallet_account_id uuid not null,
  -- Exists only to carry the type-pinned FK. In neither client grant, so it
  -- always takes its DEFAULT.
  wallet_account_type public.account_type not null default 'wallet'
    constraint goals_wallet_type_check check (wallet_account_type = 'wallet'),
  name text not null
    constraint goals_name_check check (btrim(name) <> '' and char_length(name) <= 60),
  target_minor bigint not null
    constraint goals_target_positive_check check (target_minor > 0 and target_minor < 900000000000000),
  target_date date,
  priority smallint not null default 100,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint goals_id_user_uk unique (id, user_id),
  -- A wallet backs at most one goal, archived goals included (ADR-0026).
  constraint goals_wallet_uk unique (wallet_account_id),
  -- NO ACTION rather than RESTRICT, for the cascade reason given in the
  -- transactions migration. A retype or a delete of the wallet still fails.
  constraint goals_wallet_fk foreign key (wallet_account_id, user_id, wallet_account_type)
    references public.accounts (id, user_id, type)
);

create index goals_user_active_idx on public.goals (user_id, priority) where archived_at is null;

create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

alter table public.goals enable row level security;
alter table public.goals force row level security;

revoke all on public.goals from anon, authenticated;
grant select, delete on public.goals to authenticated;
-- wallet_account_id is insert-only: re-pointing a goal at a fuller wallet would
-- complete it with no money moving (SECURITY.md §4.4).
grant insert (user_id, wallet_account_id, name, target_minor, target_date, priority)
  on public.goals to authenticated;
grant update (name, target_minor, target_date, priority, archived_at)
  on public.goals to authenticated;

create policy goals_select on public.goals
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy goals_insert on public.goals
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy goals_update on public.goals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy goals_delete on public.goals
  for delete to authenticated
  using (user_id = (select auth.uid()));
