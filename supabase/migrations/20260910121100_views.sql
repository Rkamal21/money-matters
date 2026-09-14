-- Derived data: views, not columns. DATABASE.md §8.
--
-- Every view is `security_invoker = true`, so it runs with the querying
-- user's privileges and the underlying RLS policies still apply. A view
-- without that flag runs as its owner and is a silent RLS bypass; the schema
-- suite asserts the flag on every view in `public` (SECURITY.md §8.2).

-- One row per (transaction, affected account). A transfer produces two rows
-- with opposite signs, which is precisely why a transfer can never appear as
-- income or expense (ADR-0017).
create view public.account_entries with (security_invoker = true) as
  select t.user_id, t.account_id, t.id as transaction_id, 'primary'::text as leg,
         t.occurred_on, t.currency_code,
         case t.kind
           when 'income' then t.amount_minor
           when 'refund' then t.amount_minor
           else -t.amount_minor          -- expense, transfer-out
         end as signed_amount_minor
    from public.transactions t
   where t.deleted_at is null and t.status = 'confirmed'
  union all
  select t.user_id, t.counter_account_id, t.id, 'counter'::text,
         t.occurred_on, t.currency_code, t.amount_minor  -- transfer-in
    from public.transactions t
   where t.kind = 'transfer' and t.counter_account_id is not null
     and t.deleted_at is null and t.status = 'confirmed';

create view public.account_balances with (security_invoker = true) as
  select a.user_id, a.id as account_id, a.currency_code,
         (a.opening_balance_minor + coalesce(sum(e.signed_amount_minor), 0))::bigint as balance_minor
    from public.accounts a
    left join public.account_entries e on e.account_id = a.id and e.user_id = a.user_id
   group by a.user_id, a.id, a.currency_code, a.opening_balance_minor;

-- Splits and un-split transactions unified, so every analytics query has one shape.
create view public.transaction_category_amounts with (security_invoker = true) as
  select t.user_id, t.id as transaction_id, t.occurred_on, t.kind,
         coalesce(s.category_id, t.category_id) as category_id,
         coalesce(s.amount_minor, t.amount_minor) as amount_minor
    from public.transactions t
    left join public.transaction_splits s on s.transaction_id = t.id and s.user_id = t.user_id
   where t.deleted_at is null and t.status = 'confirmed'
     and t.kind in ('expense', 'income', 'refund');

-- A goal's progress is its wallet's balance (ADR-0026). `reached` is sticky:
-- it asks whether the running balance EVER met the target, so spending the
-- money on its purpose does not un-achieve the goal.
create view public.goal_progress with (security_invoker = true) as
  with running as (
    select e.account_id, e.occurred_on,
           sum(sum(e.signed_amount_minor))
             over (partition by e.account_id order by e.occurred_on) as net_to_date_minor
      from public.account_entries e
     where e.account_id in (select g.wallet_account_id from public.goals g)
     group by e.account_id, e.occurred_on
  )
  select g.user_id, g.id as goal_id, g.wallet_account_id, b.currency_code, g.target_minor,
         b.balance_minor,
         (a.opening_balance_minor >= g.target_minor
           or exists (select 1 from running r
                       where r.account_id = g.wallet_account_id
                         and a.opening_balance_minor + r.net_to_date_minor >= g.target_minor))
           as reached,
         case when a.opening_balance_minor < g.target_minor then
           (select min(r.occurred_on) from running r
             where r.account_id = g.wallet_account_id
               and a.opening_balance_minor + r.net_to_date_minor >= g.target_minor)
         end as reached_on
    from public.goals g
    join public.accounts a on a.id = g.wallet_account_id
    join public.account_balances b on b.account_id = g.wallet_account_id;

revoke all on public.account_entries from anon, authenticated;
revoke all on public.account_balances from anon, authenticated;
revoke all on public.transaction_category_amounts from anon, authenticated;
revoke all on public.goal_progress from anon, authenticated;

grant select on public.account_entries to authenticated;
grant select on public.account_balances to authenticated;
grant select on public.transaction_category_amounts to authenticated;
grant select on public.goal_progress to authenticated;
