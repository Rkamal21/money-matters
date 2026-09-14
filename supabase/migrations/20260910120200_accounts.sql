-- Accounts: where money physically sits. DATABASE.md §6.2.
--
-- Balances are NOT stored here; `account_balances` derives them from the
-- ledger (20260910121100). A wallet is a container for money with a purpose,
-- and the only account type a goal may point at (ADR-0026) — which is what the
-- (id, user_id, type) unique key exists for.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null
    constraint accounts_name_check check (btrim(name) <> '' and char_length(name) <= 60),
  type public.account_type not null,
  currency_code char(3) not null default 'INR'
    constraint accounts_currency_code_check check (currency_code ~ '^[A-Z]{3}$'),
  opening_balance_minor bigint not null default 0
    constraint accounts_opening_balance_range_check
      check (opening_balance_minor > -900000000000000 and opening_balance_minor < 900000000000000),
  credit_limit_minor bigint
    constraint accounts_credit_limit_range_check
      check (credit_limit_minor >= 0 and credit_limit_minor < 900000000000000),
  institution text
    constraint accounts_institution_length_check check (char_length(institution) <= 60),
  -- Display only. A full account number is never stored (SECURITY.md §7).
  last4 text
    constraint accounts_last4_check check (last4 ~ '^[0-9]{4}$'),
  is_archived boolean not null default false,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounts_credit_limit_card_only_check
    check (credit_limit_minor is null or type = 'credit_card'),
  constraint accounts_user_name_uk unique (user_id, name),
  -- The composite-FK targets (DATABASE.md §7).
  constraint accounts_id_user_uk unique (id, user_id),
  constraint accounts_id_user_type_uk unique (id, user_id, type)
);

create index accounts_user_active_idx on public.accounts (user_id, position) where not is_archived;

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;
alter table public.accounts force row level security;

revoke all on public.accounts from anon, authenticated;
grant select, delete on public.accounts to authenticated;
grant insert (user_id, name, type, currency_code, opening_balance_minor, credit_limit_minor,
              institution, last4, is_archived, position)
  on public.accounts to authenticated;
-- currency_code is insert-only: re-denominating an account with history would
-- mix currencies inside one ledger (ARCHITECTURE.md A2).
grant update (name, type, opening_balance_minor, credit_limit_minor, institution, last4,
              is_archived, position)
  on public.accounts to authenticated;

create policy accounts_select on public.accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy accounts_insert on public.accounts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy accounts_update on public.accounts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy accounts_delete on public.accounts
  for delete to authenticated
  using (user_id = (select auth.uid()));
