-- Where a detected transaction came from, and the opening-balance shift an
-- imported past message needs. ROADMAP.md M12; ADR-0015 (amended 2026-10-04).
--
-- A detected transaction is written by the app's one write path
-- (saveTransaction → INSERT), so it is born `source = 'manual'` like any typed
-- entry: `source` is server-owned (ADR-0019) and the client cannot set it.
-- `record_transaction_origin` records the origin afterwards — once. It acts
-- only on a row still marked 'manual', so a retry after a lost response is a
-- no-op.
--
-- The opening balance is "the balance before the first tracked transaction"
-- (DATABASE.md §6.2). A message imported from the inbox that predates the
-- account is already inside the balance the user typed when creating it, so
-- recording it must not move today's balance: the opening balance absorbs it.
-- That happens in the same statement transaction as the origin mark, so it
-- happens exactly once — the client cannot make an insert and an account
-- update atomic, and a retried adjustment would double it.

-- Payment-app notifications (GPay, PhonePe, Paytm…) are a source of their own.
alter type public.transaction_source add value if not exists 'notification';

-- ---------------------------------------------------------------------------
-- record_transaction_origin(transaction id, source, message time) → applied?
--
-- `p_message_at` is when the bank sent the message; only an 'import' passes
-- it. The account's `created_at` is the moment its opening balance was true,
-- so a message sent before it is absorbed. Wallets are never adjusted: a goal
-- wallet's opening balance is goal progress (ADR-0026), and nothing is
-- imported into one. Transfers are never adjusted either: none is imported.
--
-- SECURITY DEFINER because `source` and the adjustment's guard are
-- server-owned; the caller comes from auth.uid(), and a missing row, someone
-- else's row and an already-recorded row all answer `false`.
-- ---------------------------------------------------------------------------
create or replace function public.record_transaction_origin(
  p_transaction_id uuid,
  p_source public.transaction_source,
  p_message_at timestamptz default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tx public.transactions;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_source::text not in ('sms', 'notification', 'import') then
    raise exception 'unsupported source' using errcode = '22023';
  end if;

  update public.transactions t
     set source = p_source
   where t.id = p_transaction_id
     and t.user_id = v_user
     and t.source = 'manual'
     and t.deleted_at is null
  returning t.* into v_tx;
  if not found then
    return false;
  end if;

  if p_source::text = 'import' and p_message_at is not null
     and v_tx.kind in ('expense', 'income', 'refund') then
    update public.accounts a
       set opening_balance_minor = a.opening_balance_minor
             + case when v_tx.kind = 'expense' then v_tx.amount_minor else -v_tx.amount_minor end
     where a.id = v_tx.account_id
       and a.user_id = v_user
       and a.type <> 'wallet'
       and p_message_at < a.created_at;
  end if;

  return true;
end;
$$;

revoke all on function public.record_transaction_origin(uuid, public.transaction_source, timestamptz)
  from public, anon;
grant execute on function public.record_transaction_origin(uuid, public.transaction_source, timestamptz)
  to authenticated;
