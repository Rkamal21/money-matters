-- A goal's progress is its wallet's balance, and money enters and leaves a
-- goal's wallet only through transactions (ADR-0026). The wallet's opening
-- balance is part of that balance, so changing it once a goal stands on the
-- wallet would move the goal's progress — or complete it — with no money
-- moving. ROADMAP.md M6: "Nothing but a transaction on the wallet can change
-- goal progress."
--
-- Found by the acceptance audit of 2026-10-06. `opening_balance_minor` is in
-- the accounts UPDATE grant, rightly: an ordinary account's starting balance
-- gets corrected. Nothing stopped the same edit on a wallet backing a goal.
--
-- The opening balance a wallet had when its goal was created still counts
-- (ADR-0026: a goal can be reached by its opening balance); it is the later
-- edit that is refused. Deleting the goal frees the wallet again.

create or replace function public.prevent_goal_wallet_opening_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.opening_balance_minor is distinct from old.opening_balance_minor
     and exists (select 1 from public.goals g where g.wallet_account_id = old.id) then
    raise exception 'a goal''s wallet changes only through transactions'
      using errcode = '23514', constraint = 'accounts_goal_wallet_opening_fixed';
  end if;
  return new;
end
$$;

revoke all on function public.prevent_goal_wallet_opening_change() from public, anon, authenticated;

create trigger accounts_goal_wallet_opening_fixed
  before update of opening_balance_minor on public.accounts
  for each row execute function public.prevent_goal_wallet_opening_change();
