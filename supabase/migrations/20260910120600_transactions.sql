-- The ledger. DATABASE.md §6.4 — the most important table in the system.
--
-- `amount_minor` is always positive; direction lives in `kind`, never in a
-- sign. A transfer is one row with two account references (ADR-0017), and the
-- shape constraints below are what make it structurally incapable of looking
-- like income or spending.
--
-- Foreign keys are `NO ACTION` rather than the `RESTRICT` DATABASE.md names.
-- For a user's own deletes the two are identical (the delete fails with
-- 23503). They differ only when parent and child are removed by the same
-- statement — deleting an auth user cascades to both accounts and
-- transactions — where RESTRICT fires before the children are gone and would
-- make account deletion impossible. NO ACTION checks at the end of the
-- statement, by which point the cascade has removed both.

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,
  counter_account_id uuid,
  kind public.transaction_kind not null,
  amount_minor bigint not null,
  currency_code char(3) not null default 'INR'
    constraint tx_currency_code_check check (currency_code ~ '^[A-Z]{3}$'),
  category_id uuid,
  merchant_label text
    constraint tx_merchant_label_length_check check (char_length(merchant_label) <= 80),
  description text not null default ''
    constraint tx_description_length_check check (char_length(description) <= 280),
  occurred_on date not null,
  occurred_at timestamptz,
  source public.transaction_source not null default 'manual',
  status public.transaction_status not null default 'confirmed',
  refund_of_transaction_id uuid,
  external_ref text
    constraint tx_external_ref_length_check check (char_length(external_ref) <= 200),
  dedupe_hash bytea,
  client_request_id uuid,
  is_split boolean not null default false,
  notes text
    constraint tx_notes_length_check check (char_length(notes) <= 1000),
  metadata jsonb not null default '{}'::jsonb
    constraint tx_metadata_size_check check (pg_column_size(metadata) < 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint tx_amount_positive_check
    check (amount_minor > 0 and amount_minor < 900000000000000),
  constraint tx_transfer_shape check (
    (kind = 'transfer'
       and counter_account_id is not null
       and counter_account_id <> account_id
       and category_id is null)
    or
    (kind <> 'transfer' and counter_account_id is null)
  ),
  constraint tx_category_present check (kind = 'transfer' or is_split or category_id is not null),
  constraint tx_split_has_no_direct_category check (not is_split or category_id is null),
  constraint tx_refund_shape check (kind = 'refund' or refund_of_transaction_id is null),
  constraint tx_occurred_lower_bound check (occurred_on >= date '2000-01-01'),

  constraint transactions_id_user_uk unique (id, user_id),
  constraint tx_account_fk foreign key (account_id, user_id)
    references public.accounts (id, user_id),
  constraint tx_counter_account_fk foreign key (counter_account_id, user_id)
    references public.accounts (id, user_id),
  constraint tx_category_fk foreign key (category_id, user_id)
    references public.categories (id, user_id),
  constraint tx_refund_of_fk foreign key (refund_of_transaction_id, user_id)
    references public.transactions (id, user_id) on delete set null (refund_of_transaction_id)
);

-- ---------------------------------------------------------------------------
-- Indexes — DATABASE.md §6.4, matched to the query shapes in API.md
-- ---------------------------------------------------------------------------
create index tx_user_date_idx on public.transactions (user_id, occurred_on desc, id desc)
  where deleted_at is null;
create index tx_user_account_idx on public.transactions (user_id, account_id, occurred_on)
  where deleted_at is null;
create index tx_user_counter_idx on public.transactions (user_id, counter_account_id, occurred_on)
  where counter_account_id is not null and deleted_at is null;
create index tx_user_category_idx on public.transactions (user_id, category_id, occurred_on)
  where deleted_at is null and category_id is not null;
create index tx_review_queue_idx on public.transactions (user_id, created_at desc)
  where status in ('detected', 'pending_review');
create unique index tx_client_request_uk on public.transactions (user_id, client_request_id)
  where client_request_id is not null;
create unique index tx_dedupe_uk on public.transactions (user_id, dedupe_hash)
  where dedupe_hash is not null;
create index tx_search_trgm_idx on public.transactions
  using gin ((coalesce(merchant_label, '') || ' ' || description) gin_trgm_ops);

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- enforce_transaction_rules() — the invariants a CHECK cannot express.
--
--   * occurred_on no more than five years ahead. Needs current_date, which is
--     not IMMUTABLE, so it cannot be a CHECK (DATABASE.md §6.4).
--   * the category's kind matches the transaction's: income is filed under an
--     income category; expense and refund under an expense category.
--   * the currency matches the account's, on both legs of a transfer.
--   * a refund points at an expense.
--
-- Raises only, writes nothing, so it runs as the invoker. The lookups go
-- through RLS; a reference to another user's row finds nothing here and is
-- then refused by the composite foreign key with 23503.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_transaction_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category_kind public.category_kind;
  v_currency char(3);
  v_parent_kind public.transaction_kind;
begin
  if new.occurred_on > current_date + interval '5 years' then
    raise exception 'occurred_on is too far in the future'
      using errcode = '23514', constraint = 'tx_occurred_upper_bound';
  end if;

  if new.category_id is not null then
    select c.kind into v_category_kind
      from public.categories c
     where c.id = new.category_id and c.user_id = new.user_id;
    if found and v_category_kind <> (case when new.kind = 'income' then 'income' else 'expense' end)::public.category_kind then
      raise exception 'the category kind does not match the transaction kind'
        using errcode = '23514', constraint = 'tx_category_kind_match';
    end if;
  end if;

  select a.currency_code into v_currency
    from public.accounts a
   where a.id = new.account_id and a.user_id = new.user_id;
  if found and v_currency <> new.currency_code then
    raise exception 'the currency does not match the account'
      using errcode = '23514', constraint = 'tx_currency_matches_account';
  end if;

  if new.counter_account_id is not null then
    select a.currency_code into v_currency
      from public.accounts a
     where a.id = new.counter_account_id and a.user_id = new.user_id;
    if found and v_currency <> new.currency_code then
      raise exception 'the currency does not match the destination account'
        using errcode = '23514', constraint = 'tx_currency_matches_account';
    end if;
  end if;

  if new.refund_of_transaction_id is not null then
    select t.kind into v_parent_kind
      from public.transactions t
     where t.id = new.refund_of_transaction_id and t.user_id = new.user_id;
    if found and v_parent_kind <> 'expense' then
      raise exception 'a refund must point at an expense'
        using errcode = '23514', constraint = 'tx_refund_of_expense';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enforce_transaction_rules() from public, anon, authenticated;

create trigger transactions_enforce_rules
  before insert or update on public.transactions
  for each row execute function public.enforce_transaction_rules();

-- ---------------------------------------------------------------------------
-- RLS and grants — SECURITY.md §4.1, verbatim
-- ---------------------------------------------------------------------------
alter table public.transactions enable row level security;
alter table public.transactions force row level security;

revoke all on public.transactions from anon, authenticated;
grant select, delete on public.transactions to authenticated;

-- A column absent from the grant cannot be supplied by the client on either
-- path; it takes its DEFAULT on insert (ADR-0019).
grant insert (user_id, account_id, counter_account_id, kind, amount_minor, currency_code,
              category_id, merchant_label, description, occurred_on, occurred_at,
              notes, metadata, client_request_id, refund_of_transaction_id)
  on public.transactions to authenticated;
grant update (account_id, counter_account_id, kind, amount_minor, currency_code,
              category_id, merchant_label, description, occurred_on, occurred_at,
              notes, metadata, deleted_at)
  on public.transactions to authenticated;

-- Absent from BOTH grants, therefore server-owned: id, created_at, updated_at,
-- source, status, is_split, dedupe_hash, external_ref.
-- Absent from UPDATE only, therefore set once at creation: user_id,
-- client_request_id, refund_of_transaction_id.

create policy transactions_select on public.transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy transactions_update on public.transactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy transactions_delete on public.transactions
  for delete to authenticated
  using (user_id = (select auth.uid()));
