-- audit_log — "why did my budget change?" and "what did I edit last Tuesday?"
-- DATABASE.md §6.11.
--
-- Written only by the SECURITY DEFINER `audit_row()` trigger. The client has
-- SELECT on its own rows and no write grant at all.

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  action text not null
    constraint audit_log_action_check check (action in ('insert', 'update', 'delete')),
  changed_fields jsonb not null default '{}'::jsonb,
  actor uuid,
  created_at timestamptz not null default now()
);

create index audit_user_time_idx on public.audit_log (user_id, created_at desc);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- audit_row() — AFTER INSERT/UPDATE/DELETE. Records the fields that changed,
-- old and new, and who changed them.
--
-- A user being deleted takes their ledger with them through ON DELETE
-- CASCADE; auditing those deletes would write rows for a user that no longer
-- exists and fail the whole deletion, so they are skipped.
-- ---------------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_user uuid;
  v_row uuid;
  v_changes jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;

  v_user := coalesce(v_new ->> 'user_id', v_old ->> 'user_id')::uuid;
  v_row := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;

  if not exists (select 1 from auth.users u where u.id = v_user) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_changes := v_new - 'user_id' - 'created_at' - 'updated_at';
  elsif tg_op = 'DELETE' then
    v_changes := v_old - 'user_id' - 'created_at' - 'updated_at';
  else
    select jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value))
      into v_changes
      from jsonb_each(v_new) n
     where n.key not in ('updated_at', 'created_at')
       and (v_old -> n.key) is distinct from n.value;
    if v_changes is null then
      return null;
    end if;
  end if;

  insert into public.audit_log (user_id, table_name, row_id, action, changed_fields, actor)
  values (v_user, tg_table_name, v_row, lower(tg_op), v_changes, auth.uid());

  return null;
end
$$;

revoke all on function public.audit_row() from public, anon, authenticated;

create trigger transactions_audit
  after insert or update or delete on public.transactions
  for each row execute function public.audit_row();

create trigger budget_periods_audit
  after insert or update or delete on public.budget_periods
  for each row execute function public.audit_row();

create trigger budget_category_limits_audit
  after insert or update or delete on public.budget_category_limits
  for each row execute function public.audit_row();

create trigger goals_audit
  after insert or update or delete on public.goals
  for each row execute function public.audit_row();
