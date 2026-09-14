-- Categories: the spending taxonomy, seeded per user (ADR-0008). DATABASE.md §6.3.
--
-- `slug` is the stable machine key merchant rules bind to. It is derived from
-- `name` by `set_category_slug()` and is absent from both client grants, so a
-- client can neither choose it nor change it (API.md §2.4).

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null
    constraint categories_slug_format_check check (slug ~ '^[a-z0-9_]{1,40}$'),
  name text not null
    constraint categories_name_check check (btrim(name) <> '' and char_length(name) <= 40),
  kind public.category_kind not null default 'expense',
  -- The safe daily limit depends on this: it separates committed money from
  -- spendable money (FINANCIAL-ENGINE.md §3).
  treatment public.category_treatment not null default 'variable',
  -- A lucide icon name and a design-token colour name, never a hex value.
  icon text not null default 'circle'
    constraint categories_icon_format_check check (icon ~ '^[a-z0-9-]{1,40}$'),
  color text not null default 'neutral'
    constraint categories_color_format_check check (color ~ '^[a-z0-9-]{1,20}$'),
  is_system boolean not null default false,
  is_archived boolean not null default false,
  position smallint not null default 0,
  parent_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint categories_user_slug_uk unique (user_id, slug),
  constraint categories_id_user_uk unique (id, user_id),
  -- SET NULL on the one column only: nulling user_id as well would violate NOT NULL.
  constraint categories_parent_fk foreign key (parent_id, user_id)
    references public.categories (id, user_id) on delete set null (parent_id)
);

create index categories_user_active_idx on public.categories (user_id, kind, position)
  where not is_archived;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- set_category_slug() — BEFORE INSERT. Derives the slug from the name when the
-- writer did not supply one (a client never can; `handle_new_user` does).
-- Collisions within a user get a numeric suffix: "Food" twice is food, food_2.
-- ---------------------------------------------------------------------------
create or replace function public.set_category_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 1;
begin
  if new.slug is not null then
    return new;
  end if;

  v_base := left(trim(both '_' from regexp_replace(lower(new.name), '[^a-z0-9]+', '_', 'g')), 34);
  if v_base = '' then
    v_base := 'category';
  end if;

  v_candidate := v_base;
  while exists (
    select 1 from public.categories c where c.user_id = new.user_id and c.slug = v_candidate
  ) loop
    v_n := v_n + 1;
    v_candidate := v_base || '_' || v_n;
  end loop;

  new.slug := v_candidate;
  return new;
end
$$;

revoke all on function public.set_category_slug() from public, anon, authenticated;

create trigger categories_set_slug
  before insert on public.categories
  for each row execute function public.set_category_slug();

-- ---------------------------------------------------------------------------
-- prevent_system_category_delete() — BEFORE DELETE. A seeded category can be
-- renamed and archived but not deleted.
--
-- `pg_trigger_depth() = 1` limits the refusal to a direct DELETE. When an auth
-- user is deleted, the cascade arrives through the foreign key's own trigger
-- (depth 2) and must be let through, or no account could ever be deleted.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_system_category_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_system and pg_catalog.pg_trigger_depth() = 1 then
    raise exception 'system categories cannot be deleted; archive it instead'
      using errcode = '23514', constraint = 'categories_system_not_deletable';
  end if;
  return old;
end
$$;

revoke all on function public.prevent_system_category_delete() from public, anon, authenticated;

create trigger categories_prevent_system_delete
  before delete on public.categories
  for each row execute function public.prevent_system_category_delete();

-- ---------------------------------------------------------------------------
-- RLS and grants (SECURITY.md §4.3)
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.categories force row level security;

revoke all on public.categories from anon, authenticated;
grant select, delete on public.categories to authenticated;
-- Absent from INSERT: id, slug (trigger-derived), is_system, timestamps.
grant insert (user_id, name, kind, treatment, icon, color, is_archived, position, parent_id)
  on public.categories to authenticated;
-- Absent from UPDATE as well: user_id, and `kind` — flipping a category in use
-- from expense to income would silently re-sign every transaction filed in it.
grant update (name, treatment, icon, color, is_archived, position, parent_id)
  on public.categories to authenticated;

create policy categories_select on public.categories
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy categories_insert on public.categories
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy categories_update on public.categories
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy categories_delete on public.categories
  for delete to authenticated
  using (user_id = (select auth.uid()));
