-- handle_new_user() — DATABASE.md §6.3 and §10.
--
-- Creates the profile, the gamification profile and the twelve default
-- categories in the same transaction as the auth user, so a user can never
-- exist half-provisioned. It lives in its own migration because it needs all
-- three tables to exist first (DATABASE.md §13).
--
-- The category rows below are a COPY of the list in supabase/seed.sql, pasted
-- from supabase/generated/default_categories.sql. The copy is allowed and the
-- drift is not: `npm run gen:categories -- --check` fails if this block ever
-- differs from the generated file (ADR-0023).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_timezone text;
begin
  v_display_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);
  v_timezone := new.raw_user_meta_data ->> 'timezone';
  if v_timezone is null or not public.is_valid_timezone(v_timezone) then
    v_timezone := 'Asia/Kolkata';
  end if;

  insert into public.profiles (id, display_name, timezone)
  values (new.id, v_display_name, v_timezone);

  insert into public.gamification_profiles (user_id)
  values (new.id);

  insert into public.categories (user_id, slug, name, kind, treatment, icon, color, position, is_system)
  select new.id, c.slug, c.name, c.kind::public.category_kind, c.treatment::public.category_treatment,
         c.icon, c.color, c.position, true
    from (values
-- >>> BEGIN GENERATED DEFAULT CATEGORIES
  ('food', 'Food', 'expense', 'variable', 'utensils', 'orange', 1),
  ('transport', 'Transport', 'expense', 'variable', 'car', 'blue', 2),
  ('shopping', 'Shopping', 'expense', 'variable', 'shopping-bag', 'pink', 3),
  ('bills', 'Bills', 'expense', 'fixed', 'receipt', 'slate', 4),
  ('entertainment', 'Entertainment', 'expense', 'variable', 'clapperboard', 'purple', 5),
  ('healthcare', 'Healthcare', 'expense', 'variable', 'heart-pulse', 'red', 6),
  ('education', 'Education', 'expense', 'variable', 'graduation-cap', 'teal', 7),
  ('travel', 'Travel', 'expense', 'variable', 'plane', 'sky', 8),
  ('personal', 'Personal', 'expense', 'variable', 'user', 'amber', 9),
  ('other', 'Other', 'expense', 'variable', 'circle', 'neutral', 10),
  ('salary', 'Salary', 'income', 'variable', 'briefcase', 'green', 11),
  ('other_income', 'Other Income', 'income', 'variable', 'circle-plus', 'emerald', 12)
-- <<< END GENERATED DEFAULT CATEGORIES
    ) as c (slug, name, kind, treatment, icon, color, position);

  return new;
end
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
