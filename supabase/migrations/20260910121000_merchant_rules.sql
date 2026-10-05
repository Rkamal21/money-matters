-- Merchant rules: merchant text → category suggestion. DATABASE.md §6.10.
--
-- The only table shared between users, and it holds no user data: a row with
-- `user_id IS NULL` is a system rule readable by everyone; a row with a
-- user id is that user's own override, written when they correct a
-- suggestion (API.md §2.10 "learn").
--
-- Rules name a category by slug, not id: a system rule cannot reference any
-- particular user's category row, and a user who renamed "Food" still gets
-- correct suggestions because the slug never changes.
--
-- No `regex` match type (ADR-0022): contains / prefix / exact only.

create table public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  pattern text not null
    constraint mr_pattern_check check (char_length(pattern) between 2 and 100 and pattern = lower(pattern)),
  match_type public.match_type not null default 'contains',
  merchant_label text not null
    constraint mr_label_check check (btrim(merchant_label) <> '' and char_length(merchant_label) <= 80),
  category_slug text not null
    constraint mr_category_slug_check check (category_slug ~ '^[a-z0-9_]{1,40}$'),
  confidence numeric(3, 2) not null default 0.90
    constraint mr_confidence_check check (confidence between 0 and 1),
  -- Lower wins. User rules are written at 10, system rules at 100.
  priority smallint not null default 10,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mr_lookup_idx on public.merchant_rules (user_id nulls last, priority) where is_enabled;
create index mr_pattern_trgm_idx on public.merchant_rules using gin (pattern gin_trgm_ops);
create unique index mr_user_pattern_uk on public.merchant_rules (user_id, pattern, match_type)
  where user_id is not null;
create unique index mr_system_pattern_uk on public.merchant_rules (pattern, match_type)
  where user_id is null;

create trigger merchant_rules_set_updated_at
  before update on public.merchant_rules
  for each row execute function public.set_updated_at();

alter table public.merchant_rules enable row level security;
alter table public.merchant_rules force row level security;

revoke all on public.merchant_rules from anon, authenticated;
grant select, delete on public.merchant_rules to authenticated;
grant insert (user_id, pattern, match_type, merchant_label, category_slug, confidence, priority, is_enabled)
  on public.merchant_rules to authenticated;
grant update (pattern, match_type, merchant_label, category_slug, confidence, priority, is_enabled)
  on public.merchant_rules to authenticated;

create policy merchant_rules_select on public.merchant_rules
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

-- System rules are readable by everyone and writable by no one.
create policy merchant_rules_insert on public.merchant_rules
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy merchant_rules_update on public.merchant_rules
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy merchant_rules_delete on public.merchant_rules
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- System rules. Data that every environment needs, so it lives in a migration
-- rather than seed.sql (which only runs locally).
--
-- Every slug in the block must be one of the default categories; the
-- category-constant check parses this block and fails on an unknown slug
-- (scripts/generate-category-constants.mjs).
-- ---------------------------------------------------------------------------
insert into public.merchant_rules (user_id, pattern, match_type, merchant_label, category_slug, confidence, priority)
select null, r.pattern, r.match_type::public.match_type, r.merchant_label, r.category_slug, r.confidence, 100
  from (values
-- >>> BEGIN SYSTEM MERCHANT RULES
  ('swiggy', 'contains', 'Swiggy', 'food', 0.95),
  ('zomato', 'contains', 'Zomato', 'food', 0.95),
  ('dominos', 'contains', 'Domino''s', 'food', 0.95),
  ('mcdonald', 'contains', 'McDonald''s', 'food', 0.95),
  ('starbucks', 'contains', 'Starbucks', 'food', 0.95),
  ('kfc', 'exact', 'KFC', 'food', 0.95),
  ('blinkit', 'contains', 'Blinkit', 'food', 0.90),
  ('zepto', 'contains', 'Zepto', 'food', 0.90),
  ('bigbasket', 'contains', 'BigBasket', 'food', 0.90),
  ('instamart', 'contains', 'Swiggy Instamart', 'food', 0.90),
  ('amazon', 'contains', 'Amazon', 'shopping', 0.90),
  ('flipkart', 'contains', 'Flipkart', 'shopping', 0.90),
  ('myntra', 'contains', 'Myntra', 'shopping', 0.95),
  ('ajio', 'contains', 'AJIO', 'shopping', 0.95),
  ('meesho', 'contains', 'Meesho', 'shopping', 0.95),
  ('dmart', 'contains', 'DMart', 'shopping', 0.90),
  ('decathlon', 'contains', 'Decathlon', 'shopping', 0.90),
  ('nykaa', 'contains', 'Nykaa', 'personal', 0.90),
  ('uber', 'contains', 'Uber', 'transport', 0.95),
  ('ola', 'exact', 'Ola', 'transport', 0.90),
  ('olacabs', 'contains', 'Ola', 'transport', 0.95),
  ('rapido', 'contains', 'Rapido', 'transport', 0.95),
  ('metro', 'contains', 'Metro', 'transport', 0.85),
  ('indian oil', 'contains', 'Indian Oil', 'transport', 0.90),
  ('hpcl', 'contains', 'HPCL', 'transport', 0.90),
  ('bharat petroleum', 'contains', 'Bharat Petroleum', 'transport', 0.90),
  ('fastag', 'contains', 'FASTag', 'transport', 0.90),
  ('irctc', 'contains', 'IRCTC', 'travel', 0.95),
  ('makemytrip', 'contains', 'MakeMyTrip', 'travel', 0.95),
  ('goibibo', 'contains', 'Goibibo', 'travel', 0.95),
  ('indigo', 'contains', 'IndiGo', 'travel', 0.90),
  ('air india', 'contains', 'Air India', 'travel', 0.90),
  ('oyo', 'exact', 'OYO', 'travel', 0.90),
  ('airbnb', 'contains', 'Airbnb', 'travel', 0.95),
  ('netflix', 'contains', 'Netflix', 'entertainment', 0.95),
  ('spotify', 'contains', 'Spotify', 'entertainment', 0.95),
  ('hotstar', 'contains', 'Disney+ Hotstar', 'entertainment', 0.95),
  ('prime video', 'contains', 'Prime Video', 'entertainment', 0.95),
  ('bookmyshow', 'contains', 'BookMyShow', 'entertainment', 0.95),
  ('pvr', 'contains', 'PVR INOX', 'entertainment', 0.90),
  ('jio', 'contains', 'Jio', 'bills', 0.90),
  ('airtel', 'contains', 'Airtel', 'bills', 0.90),
  ('vodafone', 'contains', 'Vi', 'bills', 0.90),
  ('electricity', 'contains', 'Electricity', 'bills', 0.85),
  ('bescom', 'contains', 'BESCOM', 'bills', 0.95),
  ('broadband', 'contains', 'Broadband', 'bills', 0.85),
  ('rent', 'exact', 'Rent', 'bills', 0.90),
  ('apollo', 'contains', 'Apollo', 'healthcare', 0.90),
  ('pharmeasy', 'contains', 'PharmEasy', 'healthcare', 0.95),
  ('1mg', 'contains', 'Tata 1mg', 'healthcare', 0.95),
  ('practo', 'contains', 'Practo', 'healthcare', 0.95),
  ('udemy', 'contains', 'Udemy', 'education', 0.95),
  ('coursera', 'contains', 'Coursera', 'education', 0.95),
  ('byju', 'contains', 'BYJU''S', 'education', 0.90),
  ('salary', 'contains', 'Salary', 'salary', 0.95),
  ('payroll', 'contains', 'Salary', 'salary', 0.90)
-- <<< END SYSTEM MERCHANT RULES
  ) as r (pattern, match_type, merchant_label, category_slug, confidence);
