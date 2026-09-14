-- Local development seed data, and the authoritative default-category list.
--
-- Run by `supabase db reset` after every migration has applied. It never runs
-- against a hosted project.
--
-- ============================================================================
-- Default categories — SINGLE SOURCE OF TRUTH
-- ============================================================================
-- ARCHITECTURE.md §R.5 names category slugs as the one place business data was
-- duplicated in v1 (SQL seed *and* a TypeScript list), and resolves it by
-- making the SQL seed authoritative and generating the TypeScript from it.
-- TESTING.md §4.4 turns that into a CI check: "the category constants generated
-- from seed.sql produce no diff against the committed TypeScript".
--
-- So this block is the list. `scripts/generate-category-constants.mjs` parses
-- the rows between the BEGIN and END markers and writes
-- `src/config/categories.generated.ts`. Editing that file by hand is pointless;
-- editing this block is how the list changes.
--
-- Column meanings are DATABASE.md §6.3. `icon` is a lucide icon name and
-- `color` a design-token name from src/styles/theme.css (`--color-cat-*`),
-- never a hex value, so theming stays central. Treatment follows §6.3 exactly:
-- every expense category is 'variable' except `bills`, which is 'fixed'.
--
-- >>> BEGIN DEFAULT CATEGORIES
--   (slug,           name,           kind,      treatment,  icon,             color,     position)
--   ('food',          'Food',          'expense', 'variable', 'utensils',       'orange',   1),
--   ('transport',     'Transport',     'expense', 'variable', 'car',            'blue',     2),
--   ('shopping',      'Shopping',      'expense', 'variable', 'shopping-bag',   'pink',     3),
--   ('bills',         'Bills',         'expense', 'fixed',    'receipt',        'slate',    4),
--   ('entertainment', 'Entertainment', 'expense', 'variable', 'clapperboard',   'purple',   5),
--   ('healthcare',    'Healthcare',    'expense', 'variable', 'heart-pulse',    'red',      6),
--   ('education',     'Education',     'expense', 'variable', 'graduation-cap', 'teal',     7),
--   ('travel',        'Travel',        'expense', 'variable', 'plane',          'sky',      8),
--   ('personal',      'Personal',      'expense', 'variable', 'user',           'amber',    9),
--   ('other',         'Other',         'expense', 'variable', 'circle',         'neutral', 10),
--   ('salary',        'Salary',        'income',  'variable', 'briefcase',      'green',   11),
--   ('other_income',  'Other Income',  'income',  'variable', 'circle-plus',    'emerald', 12)
-- <<< END DEFAULT CATEGORIES
--
-- How the migrations use this list (ADR-0023):
-- `handle_new_user()` inserts these rows, and it lives in a migration.
-- Migrations are forward-only and immutable once merged (DATABASE.md §13
-- rule 1), so the trigger cannot include a file that may change underneath it
-- — it has to carry the rows literally.
--
-- So the copy is allowed and the drift is not. `npm run gen:categories` writes
-- the canonical SQL rows to `supabase/generated/default_categories.sql`; the
-- signup-trigger migration carries that marked block; and
-- `gen:categories --check` — a CI job — fails if any marked block in
-- `supabase/migrations/` differs from it, or if a migration writes its own
-- category list at all. There is one list, and it is the one above.

-- ============================================================================
-- Local demo data
-- ============================================================================
-- A confirmed demo user with two months of realistic activity, so a fresh
-- `supabase db reset` opens onto a dashboard worth looking at:
--
--   email     demo@moneymatters.local
--   password  demo-password-123
--
-- Every date is relative to current_date, so the data is always "this month"
-- and "last month". Rows are written as `postgres`, so the signup trigger, the
-- ledger constraints, the audit trail and the XP triggers all run exactly as
-- they do for a real user.

do $$
declare
  v_user constant uuid := 'd3e0d3e0-0000-4000-8000-000000000001';
  v_month date := date_trunc('month', current_date)::date;
  v_prev date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_bank uuid;
  v_cash uuid;
  v_card uuid;
  v_emergency uuid;
  v_laptop uuid;
  v_period uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'demo@moneymatters.local', extensions.crypt('demo-password-123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Priya","timezone":"Asia/Kolkata"}',
    now() - interval '60 days', now(),
    '', '', '', ''
  );

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    v_user::text, v_user,
    jsonb_build_object('sub', v_user::text, 'email', 'demo@moneymatters.local', 'email_verified', true),
    'email', now(), now(), now()
  );

  update public.profiles set onboarding_completed_at = now() where id = v_user;

  insert into public.accounts (user_id, name, type, opening_balance_minor, institution, last4, position)
  values (v_user, 'HDFC Savings', 'bank', 4250000, 'HDFC', '4821', 1)
  returning id into v_bank;

  insert into public.accounts (user_id, name, type, opening_balance_minor, position)
  values (v_user, 'Cash', 'cash', 250000, 2)
  returning id into v_cash;

  insert into public.accounts (user_id, name, type, opening_balance_minor, credit_limit_minor, institution, last4, position)
  values (v_user, 'Millennia Card', 'credit_card', 0, 10000000, 'HDFC', '9034', 3)
  returning id into v_card;

  insert into public.accounts (user_id, name, type, opening_balance_minor, position)
  values (v_user, 'Emergency fund', 'wallet', 3000000, 4)
  returning id into v_emergency;

  insert into public.accounts (user_id, name, type, opening_balance_minor, position)
  values (v_user, 'Laptop fund', 'wallet', 0, 5)
  returning id into v_laptop;

  insert into public.goals (user_id, wallet_account_id, name, target_minor, target_date, priority)
  values
    (v_user, v_emergency, 'Emergency fund', 15000000, (v_month + interval '10 months')::date, 1),
    (v_user, v_laptop, 'New laptop', 8000000, (v_month + interval '4 months')::date, 2);

  insert into public.budget_periods (
    user_id, period, expected_income_minor, planned_fixed_minor, planned_savings_minor, closed_at
  )
  values (v_user, daterange(v_prev, v_month, '[)'), 7500000, 2500000, 1500000, now());

  insert into public.budget_periods (
    user_id, period, expected_income_minor, planned_fixed_minor, planned_savings_minor
  )
  values (v_user, daterange(v_month, (v_month + interval '1 month')::date, '[)'), 7500000, 2500000, 1500000)
  returning id into v_period;

  insert into public.budget_category_limits (user_id, budget_period_id, category_id, limit_minor)
  select v_user, v_period, c.id, x.limit_minor
    from (values
      ('food', 800000), ('shopping', 500000), ('transport', 400000), ('entertainment', 200000)
    ) as x (slug, limit_minor)
    join public.categories c on c.user_id = v_user and c.slug = x.slug;

  -- Last month, then this month. `least(…, current_date)` keeps this month's
  -- rows from landing in the future when the seed runs early in the month.
  insert into public.transactions (
    user_id, account_id, counter_account_id, kind, amount_minor, category_id,
    merchant_label, description, occurred_on
  )
  select v_user, x.account_id, x.counter_id, x.kind::public.transaction_kind, x.amount_minor, c.id,
         x.merchant, x.description, x.occurred_on
    from (values
      (v_bank, null::uuid, 'income', 7500000, 'salary', 'Salary', 'Monthly salary', v_prev),
      (v_bank, null::uuid, 'expense', 2200000, 'bills', 'Rent', 'Flat rent', v_prev + 1),
      (v_bank, v_emergency, 'transfer', 1000000, null, null, 'Emergency fund top-up', v_prev + 1),
      (v_card, null::uuid, 'expense', 48600, 'food', 'Swiggy', 'Dinner', v_prev + 2),
      (v_card, null::uuid, 'expense', 31800, 'transport', 'Uber', 'Airport drop', v_prev + 3),
      (v_bank, null::uuid, 'expense', 164000, 'bills', 'BESCOM', 'Electricity', v_prev + 4),
      (v_card, null::uuid, 'expense', 64900, 'entertainment', 'Netflix', 'Subscription', v_prev + 5),
      (v_card, null::uuid, 'expense', 39900, 'bills', 'Jio', 'Mobile recharge', v_prev + 6),
      (v_card, null::uuid, 'expense', 61200, 'food', 'Zomato', 'Team lunch', v_prev + 8),
      (v_bank, null::uuid, 'expense', 234000, 'food', 'BigBasket', 'Groceries', v_prev + 10),
      (v_cash, null::uuid, 'expense', 9600, 'transport', 'Rapido', 'Bike taxi', v_prev + 11),
      (v_card, null::uuid, 'expense', 349900, 'shopping', 'Amazon', 'Running shoes', v_prev + 12),
      (v_cash, null::uuid, 'expense', 76000, 'healthcare', 'Apollo', 'Pharmacy', v_prev + 14),
      (v_cash, null::uuid, 'expense', 35000, 'food', 'Starbucks', 'Coffee', v_prev + 15),
      (v_card, null::uuid, 'expense', 200000, 'transport', 'Indian Oil', 'Fuel', v_prev + 16),
      (v_card, null::uuid, 'expense', 82000, 'entertainment', 'BookMyShow', 'Movie night', v_prev + 18),
      (v_card, null::uuid, 'expense', 52900, 'food', 'Swiggy', 'Dinner', v_prev + 20),
      (v_card, null::uuid, 'expense', 189900, 'shopping', 'Myntra', 'Kurta', v_prev + 22),
      (v_bank, v_card, 'transfer', 1250000, null, null, 'Card bill payment', v_prev + 25),
      (v_bank, null::uuid, 'income', 7500000, 'salary', 'Salary', 'Monthly salary', v_month),
      (v_bank, null::uuid, 'expense', 2200000, 'bills', 'Rent', 'Flat rent', least(v_month + 1, current_date)),
      (v_bank, v_emergency, 'transfer', 1000000, null, null, 'Emergency fund top-up', least(v_month + 1, current_date)),
      (v_bank, v_laptop, 'transfer', 500000, null, null, 'Laptop savings', least(v_month + 2, current_date)),
      (v_card, null::uuid, 'expense', 45200, 'food', 'Swiggy', 'Dinner', least(v_month + 2, current_date)),
      (v_card, null::uuid, 'expense', 64900, 'entertainment', 'Netflix', 'Subscription', least(v_month + 4, current_date)),
      (v_bank, null::uuid, 'expense', 198000, 'food', 'BigBasket', 'Groceries', least(v_month + 5, current_date)),
      (v_card, null::uuid, 'expense', 26400, 'transport', 'Uber', 'Office commute', least(v_month + 6, current_date)),
      (v_card, null::uuid, 'expense', 259900, 'shopping', 'Amazon', 'Headphones', least(v_month + 7, current_date)),
      (v_card, null::uuid, 'expense', 38900, 'food', 'Zomato', 'Biryani', least(v_month + 8, current_date)),
      (v_card, null::uuid, 'expense', 59900, 'bills', 'Airtel', 'Broadband', least(v_month + 9, current_date)),
      (v_cash, null::uuid, 'expense', 31000, 'food', 'Starbucks', 'Coffee', least(v_month + 10, current_date)),
      (v_cash, null::uuid, 'expense', 8800, 'transport', 'Rapido', 'Bike taxi', least(v_month + 11, current_date)),
      (v_card, null::uuid, 'expense', 49900, 'education', 'Udemy', 'TypeScript course', least(v_month + 12, current_date)),
      (v_card, null::uuid, 'refund', 79900, 'shopping', 'Amazon', 'Headphones partial refund', least(v_month + 12, current_date)),
      (v_card, null::uuid, 'expense', 52000, 'food', 'Swiggy', 'Dinner', least(v_month + 13, current_date))
    ) as x (account_id, counter_id, kind, amount_minor, slug, merchant, description, occurred_on)
    left join public.categories c on c.user_id = v_user and c.slug = x.slug;

  update public.gamification_profiles
     set current_streak = 4, longest_streak = 9, last_check_in_on = current_date - 1
   where user_id = v_user;
end
$$;
