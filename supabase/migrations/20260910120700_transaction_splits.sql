-- Transaction splits: one purchase, several categories. DATABASE.md §6.5.
--
-- The invariant — the parts sum exactly to the parent — is a DEFERRABLE
-- INITIALLY DEFERRED constraint trigger, so several split rows written in one
-- transaction are validated at COMMIT rather than after the first row.
--
-- The trigger also maintains `transactions.is_split`, which is absent from the
-- client's grants; writing it therefore requires SECURITY DEFINER
-- (SECURITY.md §4.5 rule 6, ADR-0020).
--
-- The supported write path is `replace_transaction_splits()` (20260910121200),
-- which swaps a transaction's parts atomically. Direct writes are also granted
-- and are held to the same invariant at commit.

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  category_id uuid not null,
  amount_minor bigint not null
    constraint splits_amount_positive_check check (amount_minor > 0 and amount_minor < 900000000000000),
  note text
    constraint splits_note_length_check check (char_length(note) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transaction_splits_id_user_uk unique (id, user_id),
  constraint transaction_splits_tx_category_uk unique (transaction_id, category_id),
  constraint splits_transaction_fk foreign key (transaction_id, user_id)
    references public.transactions (id, user_id) on delete cascade,
  constraint splits_category_fk foreign key (category_id, user_id)
    references public.categories (id, user_id)
);

create index splits_user_tx_idx on public.transaction_splits (user_id, transaction_id);
create index splits_user_category_idx on public.transaction_splits (user_id, category_id);

create trigger transaction_splits_set_updated_at
  before update on public.transaction_splits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- enforce_split_rules() — BEFORE INSERT/UPDATE, per row. Raises only.
-- A part's category must be of the parent's kind, and a transfer has no parts.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_split_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_kind public.transaction_kind;
  v_category_kind public.category_kind;
begin
  select t.kind into v_parent_kind
    from public.transactions t
   where t.id = new.transaction_id and t.user_id = new.user_id;

  if found and v_parent_kind = 'transfer' then
    raise exception 'a transfer cannot be split'
      using errcode = '23514', constraint = 'tx_transfer_not_split';
  end if;

  select c.kind into v_category_kind
    from public.categories c
   where c.id = new.category_id and c.user_id = new.user_id;

  if found and v_parent_kind is not null
     and v_category_kind <> (case when v_parent_kind = 'income' then 'income' else 'expense' end)::public.category_kind then
    raise exception 'the category kind does not match the transaction kind'
      using errcode = '23514', constraint = 'tx_category_kind_match';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_split_rules() from public, anon, authenticated;

create trigger transaction_splits_enforce_rules
  before insert or update on public.transaction_splits
  for each row execute function public.enforce_split_rules();

-- ---------------------------------------------------------------------------
-- enforce_split_total() — the deferred constraint trigger.
--
-- Fires at commit for any transaction whose parts changed, and for any
-- transaction whose amount or kind changed. With parts present: at least two,
-- summing exactly to the parent, and the parent marked split with no direct
-- category. With none: the parent must not claim to be split.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_split_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx_id uuid;
  v_amount bigint;
  v_kind public.transaction_kind;
  v_is_split boolean;
  v_count integer;
  v_sum bigint;
begin
  if tg_table_name = 'transactions' then
    v_tx_id := new.id;
  elsif tg_op = 'DELETE' then
    v_tx_id := old.transaction_id;
  else
    v_tx_id := new.transaction_id;
  end if;

  select t.amount_minor, t.kind, t.is_split
    into v_amount, v_kind, v_is_split
    from public.transactions t
   where t.id = v_tx_id;

  if not found then
    -- The parent went with the same transaction (a cascade); nothing to check.
    return null;
  end if;

  select count(*), coalesce(sum(s.amount_minor), 0)::bigint
    into v_count, v_sum
    from public.transaction_splits s
   where s.transaction_id = v_tx_id;

  if v_count = 0 then
    if v_is_split then
      raise exception 'a split transaction needs its parts'
        using errcode = '23514', constraint = 'tx_split_parts_present';
    end if;
    return null;
  end if;

  if v_kind = 'transfer' then
    raise exception 'a transfer cannot be split'
      using errcode = '23514', constraint = 'tx_transfer_not_split';
  end if;

  if v_count < 2 then
    raise exception 'a split needs at least two parts'
      using errcode = '23514', constraint = 'tx_split_min_parts';
  end if;

  if v_sum <> v_amount then
    raise exception 'split parts must sum to the transaction amount'
      using errcode = '23514', constraint = 'tx_split_total_matches';
  end if;

  update public.transactions t
     set is_split = true, category_id = null
   where t.id = v_tx_id and (not t.is_split or t.category_id is not null);

  return null;
end
$$;

revoke all on function public.enforce_split_total() from public, anon, authenticated;

create constraint trigger transaction_splits_total
  after insert or update or delete on public.transaction_splits
  deferrable initially deferred
  for each row execute function public.enforce_split_total();

create constraint trigger transactions_split_total
  after update of amount_minor, kind on public.transactions
  deferrable initially deferred
  for each row execute function public.enforce_split_total();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
alter table public.transaction_splits enable row level security;
alter table public.transaction_splits force row level security;

revoke all on public.transaction_splits from anon, authenticated;
grant select, delete on public.transaction_splits to authenticated;
grant insert (user_id, transaction_id, category_id, amount_minor, note)
  on public.transaction_splits to authenticated;
grant update (category_id, amount_minor, note)
  on public.transaction_splits to authenticated;

create policy transaction_splits_select on public.transaction_splits
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy transaction_splits_insert on public.transaction_splits
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy transaction_splits_update on public.transaction_splits
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy transaction_splits_delete on public.transaction_splits
  for delete to authenticated
  using (user_id = (select auth.uid()));
