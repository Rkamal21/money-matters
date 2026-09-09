# Money Matters 2.0 — Security Architecture

Status: **Proposed** · Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) and [DATABASE.md](./DATABASE.md) · Date: 2026-09-07

---

## 1. The security premise

There is no application server. The browser talks to PostgREST with the user's own JWT. That makes
one sentence true and everything in this document follows from it:

> **The client is a hostile input source, and the database is the only trust boundary.**

Anyone can open devtools, copy their access token, and `curl` the REST endpoint. Every rule that
matters — who owns a row, whether an amount is positive, how much XP was earned — must therefore be
enforced by PostgreSQL. TypeScript validation exists for user experience. It is not a control.

v1 violated this premise in three places, each independently sufficient to invalidate every number
the app displayed:

```
# v1, from the browser console, with nothing but the user's own session:
supabase.from('profiles').update({ xp: 999999, level: 100 }).eq('id', me)
supabase.from('goals').update({ current: 50000 }).eq('id', myGoal)
supabase.from('expenses').insert({ user_id: me, amount: -5000, category: 'Food' })
```

The third one is subtle and the most damaging: a negative expense silently inflated every total the
dashboard computed.

---

## 2. Trust boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│ UNTRUSTED                                                            │
│   Browser / Android WebView · React · domain calculations · Zod      │
│   Holds: access token (1h), refresh token. Can be fully rewritten    │
│   by the user. Every value it sends is an assertion, not a fact.     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  HTTPS + Authorization: Bearer <JWT>
┌──────────────────────────────▼───────────────────────────────────────┐
│ SUPABASE EDGE (gateway)  · TLS termination · auth rate limits        │
├──────────────────────────────────────────────────────────────────────┤
│ GoTrue (auth)       PostgREST (data)        Edge Functions (future)  │
│ issues/validates    maps HTTP → SQL as      hold secrets the client  │
│ the JWT             role `authenticated`    must never see           │
├──────────────────────────────────────────────────────────────────────┤
│ TRUSTED — PostgreSQL                                                 │
│   GRANTs → RLS → composite FKs → CHECKs → triggers → SECURITY DEFINER│
│   auth.uid() is derived from the verified JWT. It cannot be spoofed  │
│   by any request body.                                               │
└──────────────────────────────────────────────────────────────────────┘
```

**The `service_role` key never leaves the server side.** It bypasses RLS entirely. It exists in
exactly two places: GitHub Actions secrets (for CI database setup) and Edge Function environment
variables. A CI grep fails the build if `service_role` appears anywhere under `src/` or in any
`VITE_`-prefixed variable.

---

## 3. Authentication architecture

Supabase Auth (GoTrue). No custom auth — rolling our own password hashing, reset-token expiry, and
session rotation would be a large amount of security-critical code with no product upside.

| Flow | Design |
|---|---|
| **Registration** | Email + password. Password policy: ≥ 10 characters, checked against a common-password list client-side and by GoTrue's minimum length server-side. Email confirmation **required** before first sign-in. `handle_new_user` trigger creates `profiles`, `gamification_profiles`, and seed categories in one transaction. |
| **Login** | `signInWithPassword`. Failure returns one generic message ("Email or password is incorrect") — never "no such user", which is an account-enumeration oracle. Supabase's per-IP auth rate limit is left at its default and monitored. |
| **Logout** | `signOut({ scope: 'local' })` by default; a "sign out everywhere" action uses `scope: 'global'` to revoke all refresh tokens. Sign-out clears the TanStack Query cache — otherwise the next user on a shared device sees the previous user's cached balances. |
| **Password reset** | GoTrue magic link → `/update-password`. Tokens are single-use and short-lived. The reset request response is identical whether or not the address exists. |
| **Session persistence** | Access token 1 hour, refresh token rotating. `supabase-js` refreshes in the background. In the Capacitor shell the session is stored via a `@capacitor/preferences`-backed storage adapter rather than WebView `localStorage`, so it survives WebView data clearing and is covered by Android's app-sandbox. |
| **Auth state initialisation** | `AuthProvider` renders a splash until `getSession()` resolves **once**, then subscribes to `onAuthStateChange`. Routes never render in an indeterminate auth state — v1's `useAuth` briefly reported "signed out" on every reload, which flashed the login screen at signed-in users. |
| **Protected routes** | A `<RequireAuth>` route element redirects to `/login?returnTo=…`. This is **UX only.** The data is protected by RLS; a user who defeats the route guard sees an empty dashboard, not someone else's money. |
| **Onboarding gate** | `<RequireOnboarding>` redirects to `/onboarding` while `profiles.onboarding_completed_at IS NULL`. |
| **Token expiry mid-session** | A `401`/`PGRST301` from any request maps to `AuthenticationError`; the app attempts one silent refresh, and on failure clears the cache and redirects to `/login` preserving `returnTo`. |
| **Account deletion** | Two-step confirmation → Edge Function using `service_role` → optional JSON export → `auth.admin.deleteUser(id)`. Every application row is removed by `ON DELETE CASCADE`. Deletion is immediate and irreversible; the user is told so before confirming. |

**Not in MVP, designed for:** OAuth providers (Google), TOTP MFA (Supabase supports both; adding
them changes the auth feature only), and biometric unlock on Android (a local re-auth gate over an
existing session, not a second identity).

---

## 4. Row-Level Security design

### 4.1 The template

Applied identically to `accounts`, `categories`, `transactions`, `transaction_splits`,
`budget_periods`, `budget_category_limits`, `goals`, and `goal_contributions`:

```sql
alter table public.transactions enable row level security;
alter table public.transactions force  row level security;   -- applies to the table owner too

revoke all on public.transactions from anon, authenticated;
grant select, delete on public.transactions to authenticated;

-- INSERT and UPDATE are both column-scoped. A column absent from the grant cannot be
-- supplied by the client on either path; it takes its DEFAULT on insert. See ADR-0019.
grant insert (user_id, account_id, counter_account_id, kind, amount_minor, currency_code,
              category_id, merchant_label, description, occurred_on, occurred_at,
              notes, metadata, client_request_id, refund_of_transaction_id)
      on public.transactions to authenticated;
grant update (account_id, counter_account_id, kind, amount_minor, currency_code,
              category_id, merchant_label, description, occurred_on, occurred_at,
              notes, metadata, deleted_at)
      on public.transactions to authenticated;

-- Absent from BOTH grants, therefore server-owned: id, created_at, updated_at, source,
-- status, is_split, dedupe_hash, external_ref.
--
-- Absent from UPDATE only, therefore set once at creation: user_id, client_request_id,
-- refund_of_transaction_id. NOTE: whether a refund should be re-pointable after creation is an
-- OPEN question against Milestone 2 — this grant makes it insert-only, which is the status quo,
-- not a decision that has been taken.

create policy transactions_select on public.transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy transactions_update on public.transactions
  for update to authenticated
  using       (user_id = (select auth.uid()))
  with check  (user_id = (select auth.uid()));

create policy transactions_delete on public.transactions
  for delete to authenticated
  using (user_id = (select auth.uid()));
```

Three details that are easy to get wrong and are each doing real work:

- **`FORCE ROW LEVEL SECURITY`** — without it, policies do not apply to the table's owner, and
  Supabase migrations run as the owner. **It does not stop a `SECURITY DEFINER` bypass**, which an
  earlier draft of this document claimed: on Supabase the owning role `postgres` holds
  `rolbypassrls`, and `BYPASSRLS` defeats `FORCE`. What `FORCE` actually buys is that a future
  owner *without* `BYPASSRLS` — a dedicated maintenance role, a self-hosted deployment — is still
  policed. The verified execution model is [ADR-0020](./adr/0020-rls-execution-model.md); read it
  before writing any trigger or definer function.
- **`(select auth.uid())`** rather than bare `auth.uid()` — PostgreSQL evaluates the subquery once
  as an InitPlan instead of once per row. On a 50,000-row scan this is the difference between a
  fast query and a slow one. Correctness is identical; performance is not.
- **`WITH CHECK` on `UPDATE` as well as `USING`** — `USING` decides which rows you may *modify*;
  `WITH CHECK` decides what they may look like *afterwards*. Without it, `UPDATE transactions SET
  user_id = '<someone-else>'` succeeds: you owned the row when the check ran. v1 had exactly this
  hole on all four tables: `expenses`, `goals` and `budgets` through
  `FOR ALL USING (auth.uid() = user_id)`, and `profiles` through a separate
  `FOR UPDATE USING (auth.uid() = id)` — different shapes, same missing `WITH CHECK`.

### 4.2 Why never `FOR ALL`

`FOR ALL USING (expr)` expands to a policy covering `SELECT`, `INSERT`, `UPDATE` and `DELETE` where
the `USING` expression is *also* used as the `WITH CHECK` expression when none is given. That is not
obviously wrong — but it means (a) the four commands can never be reasoned about or tested
separately, (b) you cannot express "readable but not deletable", which closed budget periods need,
and (c) an `INSERT`-only or `SELECT`-only rule change forces you to rewrite the combined policy.
Four named policies cost eight extra lines per table and make the security review a checklist rather
than an interpretation.

### 4.3 Per-table policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own row | ✗ (trigger only) | own row, `WITH CHECK id = auth.uid()`; column grants exclude `id`, `created_at` | ✗ (cascade from auth deletion) |
| `accounts` | own | own; column grants exclude `id`, `created_at`, `updated_at` | own | own, but `RESTRICT` from `transactions` blocks any account with history |
| `categories` | own | own; column grants exclude `is_system`, `slug` (trigger-derived from `name`) | own; column grants exclude `is_system`, `slug`, `user_id` | own; `BEFORE DELETE` trigger blocks `is_system`, FK `RESTRICT` blocks in-use |
| `transactions` | own | own (column grants as §4.1) | own (column grants as §4.1) | own (soft delete preferred; hard delete permitted) |
| `transaction_splits` | own | own; column grants exclude `id`, `created_at`, `updated_at` | own | own |
| `budget_periods` | own | own; column grants exclude `id`, `created_at`, `updated_at` | own **and `closed_at IS NULL`** | own **and `closed_at IS NULL`** |
| `budget_category_limits` | own | own **and parent period open**; column grants exclude `id`, `created_at`, `updated_at` | own and parent open | own and parent open |
| `goals` | own | own; column grants exclude `saved_minor`, `achieved_at` | own; column grants exclude `saved_minor`, `achieved_at`, `user_id` | own (cascades contributions) |
| `goal_contributions` | own | ✗ **— RPC only** | ✗ | own (allows correcting a mistake; the trigger recomputes the total) |
| `gamification_profiles` | own | ✗ | ✗ | ✗ |
| `gamification_events` | own | ✗ | ✗ | ✗ |
| `user_achievements` | own | ✗ | ✗ | ✗ |
| `achievements` (catalog) | all authenticated, `USING (is_active)` | ✗ | ✗ | ✗ |
| `merchant_rules` | `user_id IS NULL OR user_id = auth.uid()` | own only (`WITH CHECK user_id = auth.uid()`); column grants exclude `id`, `created_at`, `updated_at` | own only | own only |
| `audit_log` | own | ✗ | ✗ | ✗ |

Every ✗ means **no grant at all** for `authenticated`, not merely a restrictive policy. A missing
grant is a clearer, earlier failure than a policy that evaluates to false, and it cannot be
undermined by a later permissive policy added on another branch.

The closed-period rule is written as:

```sql
create policy budget_periods_update on public.budget_periods
  for update to authenticated
  using      (user_id = (select auth.uid()) and closed_at is null)
  with check (user_id = (select auth.uid()) and closed_at is null);
```

This is why `FOR ALL` was rejected: reads of closed periods must keep working (that *is* budget
history), while writes must stop.

### 4.4 Column-level grants: where RLS runs out

RLS answers "is this row mine?" It cannot answer "may I change *this column* of my own row?"
For `goals.saved_minor` and `gamification_profiles.xp_total` the row **is** the user's — RLS will
happily allow the update. The control is the grant:

```sql
revoke insert, update on public.goals from authenticated;
grant  insert (user_id, name, target_minor, currency_code, target_date,
               linked_account_id, priority)
       on public.goals to authenticated;
grant  update (name, target_minor, target_date, linked_account_id, priority, archived_at)
       on public.goals to authenticated;
-- saved_minor and achieved_at are absent from BOTH grants ⇒ PostgreSQL rejects any INSERT or
-- UPDATE naming them with 42501 insufficient_privilege, before RLS is even consulted. On insert
-- they take their DEFAULTs (0 and NULL), which is verified behaviour, not an assumption.

revoke insert, update, delete on public.gamification_profiles from authenticated;
grant  select on public.gamification_profiles to authenticated;
```

`UPDATE goals SET saved_minor = 5000000` fails for every user, including the row's owner — and so
does `INSERT INTO goals (…, saved_minor) VALUES (…, 5000000)`. **The insert half is not optional.**
`sync_goal_saved()` fires on `goal_contributions`, not on `goals`, so a goal created with a
fabricated total is never recomputed and stays wrong forever. An earlier draft of this document
column-scoped `UPDATE` only, which left the whole control bypassable at row creation.

This is the single most important control in the gamification and goals design, and it is six
lines of DDL. See [ADR-0019](./adr/0019-insert-column-grants.md).

### 4.5 `SECURITY DEFINER` hygiene

Every definer function follows this shape:

```sql
create or replace function public.add_goal_contribution(
  p_goal_id uuid, p_amount_minor bigint, p_occurred_on date,
  p_note text default null, p_client_request_id uuid default null)
returns public.goal_contributions
language plpgsql
security definer
set search_path = ''                       -- no schema hijack
as $$
declare v_user uuid := auth.uid(); ...
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform 1 from public.goals
   where id = p_goal_id and user_id = v_user for update;   -- ownership + lock
  if not found then
    raise exception 'goal_not_found' using errcode = 'P0002';   -- same error whether
  end if;                                                       -- it is missing or someone else's
  ...
end $$;
revoke all on function public.add_goal_contribution(uuid,bigint,date,text,uuid) from public, anon;
grant execute on function public.add_goal_contribution(uuid,bigint,date,text,uuid) to authenticated;
```

Rules, each closing a specific known attack:

1. **`SET search_path = ''`** with fully-qualified names — otherwise a user-created schema earlier
   in the path can shadow `public.goals` and the definer executes attacker-chosen code.
2. **Derive the user from `auth.uid()`**, never from a parameter, **in every function granted to
   `authenticated`**. A `p_user_id` argument on a client-callable definer function is a
   horizontal-privilege-escalation hole with a friendly name. Two functions do take a user id —
   `evaluate_achievements(p_user_id)` and `recompute_goal_totals(p_user_id)` — and neither is
   granted to `authenticated`: the first is called only from inside another definer function that
   has already derived the caller, the second is an operator-run maintenance function reachable
   only with `service_role`. That exemption is the reason the grant, not the signature, is the
   control. Asserted in §8.2.
3. **`REVOKE … FROM public`** — functions are executable by `PUBLIC` by default.
4. **Identical errors for "not found" and "not yours"** — distinguishing them turns the function
   into an existence oracle for other users' ids.
5. **Never `SECURITY DEFINER` for a plain read.** If RLS can express it, RLS does it.
6. **A trigger function that writes a column excluded from the caller's grant must be
   `SECURITY DEFINER`** (with rules 1 and 3 applying to it like any other). A plain trigger
   function runs as the *invoking* user, so `sync_goal_saved()` updating `goals.saved_minor` as
   `authenticated` fails with `42501` and rolls back the whole contribution. Verified, not
   inferred — see [ADR-0020](./adr/0020-rls-execution-model.md).
7. **A definer function's reads are policed too.** Inside the function the effective user is the
   function's owner, and both its `SELECT`s and its writes go through RLS unless that owner holds
   `BYPASSRLS`. The dangerous half is that an under-privileged `UPDATE` does not error — it
   matches zero rows and returns success, so a recompute writes a silently wrong number. On
   Supabase the owner (`postgres`) holds `BYPASSRLS`, which is what makes the design work; §8.2
   asserts that, because changing a function's owner would break it without a single error.

---

## 5. Threat model

Scored *before* mitigation. "Client tampering" assumes an authenticated user with their own valid
token and full control of the request — the realistic baseline, not a worst case.

| # | Threat | Vector | Sev | Mitigation | Residual |
|---|---|---|---|---|---|
| T1 | **Cross-tenant read** (see another user's finances) | Manipulated `user_id` filter, guessed UUID, forged `Range` header | Critical | RLS `SELECT` per table; `FORCE RLS`; `security_invoker` views; CI matrix asserts every table returns 0 rows for a foreign owner | Low — a *new table without a policy* is the live risk; a CI check fails the build on any `public` table with RLS off |
| T2 | **Cross-tenant write / IDOR** | `POST /transactions {user_id: victim}`; `PATCH /goals?id=eq.<victim's>` | Critical | `WITH CHECK` on INSERT and UPDATE; `user_id` excluded from the UPDATE grant; composite FKs make even a *reference* to a foreign row impossible | Very low |
| T3 | **XP inflation** | `PATCH /gamification_profiles {xp_total: 999999}`; replaying a check-in call 100× | Medium | No write grant on the table at all; `award_xp` is the only writer; `UNIQUE(user_id, dedupe_key)` makes replay a no-op; `daily_check_in` clamps the increment to 1 and bounds `p_today` against the server date | Very low |
| T4 | **Goal balance manipulation** | `PATCH /goals {saved_minor: target}`; `POST /goals {saved_minor: target}` at creation | High | `saved_minor` and `achieved_at` absent from the INSERT grant **and** the UPDATE grant (§4.4); total is recomputed from the ledger by trigger; contributions are RPC-only | Very low |
| T5 | **Transaction amount manipulation** | Negative amount to inflate a balance; amount larger than 2^53 to corrupt the client | High | `CHECK (amount_minor > 0)` — direction lives in `kind`; upper `CHECK` keeps values inside `Number.MAX_SAFE_INTEGER`; the mapper asserts `Number.isSafeInteger` | Very low |
| T6 | **Mass assignment** | Sending `is_system`, `status`, `source`, `is_split`, `dedupe_hash`, `created_at`, `id` in a create **or** update body | Medium | Column-level grants on **both** `INSERT` and `UPDATE` (§4.1, §4.4); Zod schemas use `.strict()` and repositories build explicit column lists — a field not in the list is never sent, and one that is sent anyway is `42501` | Very low |
| T7 | **SQL injection** | Malicious input in description, merchant, filters | High | PostgREST parameterises everything; no string-concatenated SQL anywhere; RPCs use typed parameters; no `EXECUTE` with interpolated input in any function | Very low |
| T8 | **Stored XSS** | `<img onerror>` in a description or goal name, rendered into another view | High | React escapes by default; `dangerouslySetInnerHTML` is banned by lint; a strict CSP (`default-src 'self'`, no `unsafe-inline` script) blocks execution even if an escape were missed; chart labels rendered as SVG `<text>`, never HTML | Low |
| T9 | **Token theft via XSS** | Reading the session out of `localStorage` | High | The CSP above is the primary control (a token you cannot exfiltrate is far less useful — `connect-src` is restricted to the Supabase project origin); short access-token lifetime; dependency scanning via Dependabot + `npm audit` in CI; SRI is unnecessary since we self-host all JS | Medium — accepted, see §6 |
| T10 | **CSRF** | Cross-origin form post to PostgREST | Low | Auth is a `Authorization: Bearer` header, not a cookie; a cross-site form cannot set it. Supabase CORS is restricted to known origins | Negligible |
| T11 | **Duplicate transactions** | Double tap, retry storm, two devices, replayed request | Medium | `client_request_id` unique per user; optimistic-concurrency check on edits; ingest `dedupe_hash` | Low |
| T12 | **Race conditions on money** | Two concurrent contributions; two devices creating one budget period | Medium | `FOR UPDATE` row lock in the RPC; recompute-not-increment; `EXCLUDE USING gist` on period overlap; unique idempotency keys | Low |
| T13 | **Sensitive data in logs** | Full SMS body, amounts, emails, tokens in Sentry or Logcat | High | Never log message bodies (v1 did — `Log.i(TAG, "…message=$body")`); Sentry `beforeSend` scrubs `amount`, `amount_minor`, `email`, `token`, `merchant`, `description`; breadcrumbs carry route names only; a lint rule blocks `console.log` in `src/` | Low |
| T14 | **Secret leakage** | `service_role` key bundled into the client | Critical | Only `VITE_`-prefixed vars reach the bundle by construction; `config/env.ts` validates the allow-list at startup; CI greps the built bundle for `service_role` and for any JWT with `"role":"service_role"` | Very low |
| T15 | **Account enumeration** | Different responses for existing vs unknown emails on login/reset | Low | Identical generic responses on both paths; identical timing is not attempted (accepted) | Low |
| T16 | **Abuse / resource exhaustion** | Scripted inserts, expensive repeated aggregates | Medium | Supabase gateway rate limits; `PGRST_DB_MAX_ROWS` caps any single response; pagination is mandatory in the repository layer; a per-user insert throttle trigger on `transactions` and `goal_contributions` (N rows/minute) is added if abuse appears | **Medium — the honest gap**, see §6 |
| T17 | ~~**Malicious regex in a merchant rule** (ReDoS)~~ | ~~User creates `match_type='regex'` with a catastrophic pattern~~ | — | **Eliminated, not mitigated.** `regex` is removed from the `match_type` enum for the MVP ([ADR-0022](./adr/0022-drop-regex-match-type.md)); `contains`/`prefix`/`exact` carry every rule in the M3 fixtures. Pattern length stays capped at 100 chars. If a future ADR reintroduces `regex`, this threat and its mitigations (`statement_timeout`, an RE2-style engine, never PostgreSQL's backtracking `~` on user input) come back with it | None |
| T18 | **Supply-chain compromise** | A malicious dependency reading the session | High | Small, justified dependency list ([ARCHITECTURE.md §C.6](./ARCHITECTURE.md)); `package-lock.json` committed; `npm ci` only; Dependabot; CI fails on high-severity advisories; no `postinstall` scripts from untrusted packages | Medium — industry-wide, accepted |
| T19 | **Android: exported SMS receiver** | Any app broadcasting a fake `SMS_RECEIVED` into ours | Medium (future) | v1's receiver is `exported="true"` with no sender validation — a third-party app can inject fabricated transactions. Milestone 12 requires: `android:permission="android.permission.BROADCAST_SMS"` on the receiver, sender-address allow-listing, and every ingested row landing as `pending_review` regardless | Low |
| T20 | **Stale session on a shared device** | Next user sees cached balances after sign-out | Medium | `queryClient.clear()` on sign-out and on `SIGNED_OUT` events; no financial data in `localStorage`; Android `FLAG_SECURE` considered for the app-switcher screenshot | Low |

### Explicitly accepted, with reasons

- **Client-side calculation can be tampered with.** A user can make their own dashboard display a
  wrong safe daily limit. Nothing of ours depends on that output, and the underlying rows are their
  own data. Not a vulnerability — a property of the architecture, recorded so no one "fixes" it by
  moving arithmetic into RPCs.
- **Data is encrypted at rest by Supabase, not by us.** Application-level encryption of amounts
  would make every aggregate impossible in SQL and move all computation to the client. Rejected on
  a clear cost/benefit basis, not overlooked.
- **We do not defend against a fully compromised device.** Malware with the WebView's storage can
  act as the user. Mitigations belong to the platform.

---

## 6. Known gaps, stated rather than hidden

| Gap | Why it exists | Trigger to close it |
|---|---|---|
| **No per-user write rate limiting.** PostgREST enforces none; Supabase's gateway limits are per-IP and coarse. | Building a throttle before any abuse exists is speculative, and a badly tuned one blocks a legitimate CSV import. | Any observed abuse, or the first bulk-import feature. Design is ready: a `BEFORE INSERT` trigger counting the user's rows in the last 60 s against a per-table cap. |
| **Session tokens in web storage.** Supabase's browser SDK uses `localStorage`; the httpOnly-cookie alternative requires an SSR server, which we deliberately do not have. | The alternative costs the entire "no backend" architecture. | If we ever add a server tier, revisit. Meanwhile CSP + short token lifetime are the compensating controls. |
| **No MFA at MVP.** | Supabase supports TOTP; it is a Milestone 10 feature, not an architectural change. | Before any real-money or bank-connected feature ships. |
| **No formal pen test.** | Pre-launch, no budget. | Before public launch. The RLS matrix (§8) is the interim substitute and is far from equivalent. |
| **Timing-based account enumeration.** | Constant-time auth responses are outside our control in GoTrue. | Accepted. |

---

## 7. Data protection and privacy

| Data | Classification | Handling |
|---|---|---|
| Email address | PII | In `auth.users` only; never copied into `public`. Never logged, never in an analytics event. |
| Display name | PII (low) | `profiles.display_name`. |
| Transaction amounts, merchants, categories | **Sensitive financial** | Never logged. Never sent to analytics. Excluded from Sentry payloads by an allow-list `beforeSend`. |
| Account `last4`, institution | Sensitive | Display only. **Full account numbers are never stored** — there is no column for one. |
| Bank SMS body *(future)* | **Highly sensitive** | Parsed on-device, **never persisted**, **never logged**, **never transmitted**. Only extracted fields (amount, date, normalised merchant, last4) leave the parser. See §9. |
| Session tokens | Secret | Never logged, never in a URL, scrubbed from all error reports. |

**Analytics rule:** business events record *that* something happened, never *how much*.
`transaction_created { kind: 'expense', source: 'manual', has_category: true }` is allowed.
Any property whose name or value could carry an amount, a merchant, or free text is rejected by a
typed event schema — the analytics client will not compile with an unlisted property.

**Data export and deletion.** GDPR/DPDP-style rights are supported by design: export is a set of
`SELECT`s the user is already allowed to run; deletion is `ON DELETE CASCADE` from `auth.users`
plus one Edge Function. Neither needs new infrastructure.

---

## 8. Security testing

Security assertions are tests, and they run on every pull request. A design document that claims
isolation without a test asserting it is a claim, not a control.

### 8.1 The RLS isolation matrix

Two real users (A and B) are created against a local Supabase. For **every** user-owned table, and
for every command, the suite asserts that A cannot touch B's row:

| Case | Expectation |
|---|---|
| `select … where id = <B's row>` as A | 0 rows (never `403` — RLS filters, it does not error) |
| `insert {user_id: B}` as A | `42501` / policy violation |
| `insert {user_id: A, category_id: <B's category>}` as A | `23503` foreign-key violation (composite FK) |
| `insert {user_id: A, account_id: <B's account>}` as A | `23503` |
| `update <B's row>` as A | 0 rows affected |
| `update <A's row> set user_id = B` as A | policy violation (`WITH CHECK`) |
| `delete <B's row>` as A | 0 rows affected |
| `update goals set saved_minor = …` on A's own goal | `42501` insufficient privilege |
| **`insert goals {saved_minor: 5000000}`** as A | `42501` — the insert-side half of §4.4 |
| **`insert goals {achieved_at: now()}`** as A | `42501` |
| **`insert goals {name, target_minor}`** as A, no protected columns named | succeeds, and `saved_minor = 0` from its `DEFAULT` |
| **`insert categories {is_system: true}`** as A | `42501` |
| **`insert transactions {status: 'confirmed', source: 'sms'}`** as A | `42501` |
| **`insert transactions {is_split: true}`** as A | `42501` |
| `update gamification_profiles set xp_total = …` on A's own row | `42501` |
| `update categories set is_system = false` on A's own row | `42501` |
| `rpc('add_goal_contribution', {p_goal_id: <B's goal>})` as A | `goal_not_found` — the same error B's missing goal would give |
| `select` any table as `anon` | permission denied |
| calling every RPC as `anon` | permission denied |
| `update budget_periods` where `closed_at is not null` | 0 rows affected |

The suite is generated from a table list, so **adding a table without adding it to the list fails
the build** — the failure mode we most need to catch is a new table with no policy.

### 8.2 Schema-level assertions

Run as SQL in CI, as `tests/integration/schema.test.ts`.

**Every assertion below is filtered to `nspname = 'public'`, and that filter is not optional.** A
Supabase database is not only our schema: `auth`, `storage`, `realtime`, `vault`, `pgbouncer`,
`supabase_functions`, `extensions` and `pg_catalog` are managed by Supabase and by PostgreSQL
itself. We neither own them nor may change them, and they do not follow our rules. Measured on a
stock local stack (Supabase CLI 2.117, PostgreSQL 17.6), an **unfiltered** run of the queries below
reports:

| Assertion | Rows outside `public` |
|---|---|
| tables without `FORCE` RLS | **113** — `pg_catalog` 64, `auth` 23, `storage` 10, `realtime` 7, `information_schema` 4, `_realtime` 4, `supabase_functions` 2, `supabase_migrations` 2, `vault` 1 |
| views not `security_invoker` | **146** — `pg_catalog` 78, `information_schema` 65, `extensions` 2, `vault` 1 |
| `SECURITY DEFINER` without a pinned `search_path` | `vault`, `pgbouncer`, `supabase_functions` |
| `SECURITY DEFINER` owned by a role without `BYPASSRLS` | 1, in a managed schema |
| `FOR ALL` policies | **0 on a stock stack** — see the note below |

An unfiltered assertion therefore fails on day one with hundreds of rows nobody is permitted to fix,
and the predictable outcome is that someone deletes the assertion rather than restores the filter.
That is the failure this note exists to prevent.

> **On `FOR ALL` policies specifically.** An earlier draft of this section gave the reason for
> filtering as "Supabase ships `FOR ALL` policies in `auth`/`storage`/`realtime`". On a stock stack
> that is **not** true — those schemas ship no policies at all, and the assertions that actually
> break unfiltered are the two at the top of the table. The `FOR ALL` and `WITH CHECK` queries are
> still filtered, for two reasons: consistency, so no reader concludes one assertion may safely drop
> the clause; and because `storage.objects` does acquire policies as soon as storage buckets are
> configured, which is a change to the deployment, not to our schema. The conclusion was always
> right; only the evidence was wrong.

`tests/integration/schema.test.ts` also asserts the inverse — that managed schemas *do* contain what
we forbid in `public` — so that dropping a filter fails a test that names the reason, rather than
turning the whole suite red for reasons nobody is allowed to fix.

```sql
-- every table in public has RLS enabled and forced
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and (not c.relrowsecurity or not c.relforcerowsecurity);      -- must be empty

-- every view is security_invoker
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v'
   and coalesce(array_to_string(c.reloptions,','), '') not like '%security_invoker=true%';

-- no FOR ALL policies  (schema-filtered like every assertion here: managed schemas do not follow
-- our rules and we may not change them. storage.objects acquires policies once buckets are
-- configured, which is a deployment change rather than one of ours. See the note above.)
select pol.polname from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and pol.polcmd = '*';                -- must be empty

-- every UPDATE/INSERT policy has a WITH CHECK  (schema-filtered for the same reason)
select pol.polname from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and pol.polcmd in ('w','a') and pol.polwithcheck is null;

-- no SECURITY DEFINER function without a pinned search_path
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and coalesce(array_to_string(p.proconfig,','),'') not like '%search_path=%';

-- every SECURITY DEFINER function is owned by a role that can actually write through RLS.
-- Without this, changing a function's owner turns every recompute into a silent no-op
-- rather than an error. See ADR-0020.
select p.proname, r.rolname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
 where n.nspname = 'public' and p.prosecdef and not r.rolbypassrls;   -- must be empty

-- no client-callable function takes a user id: any function granted to `authenticated`
-- must derive the caller from auth.uid() (§4.5 rule 2)
select p.proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('authenticated', p.oid, 'execute')
   and pg_get_function_identity_arguments(p.oid) ~ 'p_user_id|user_id uuid';   -- must be empty

-- every trigger function that writes a protected column is SECURITY DEFINER (§4.5 rule 6).
-- Maintained as an explicit list because "writes a protected column" is not introspectable.
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not p.prosecdef
   and p.proname in ('sync_goal_saved','enforce_split_total','award_xp',
                     'audit_row','handle_new_user','evaluate_achievements');   -- must be empty
```

### 8.3 Application-level security tests

- **Bundle scan:** the built `dist/` contains no `service_role`, no JWT with `"role":"service_role"`,
  and no key not on the `VITE_` allow-list.
- **Logging scan:** no `console.log` in `src/`; a unit test feeds a payload containing `amount_minor`,
  `email`, and `access_token` through the Sentry `beforeSend` hook and asserts all three are removed.
- **E2E negative journeys** (Playwright): sign in as A, navigate directly to `/goals/<B's id>` →
  "not available" page, not a 500 and not B's goal; sign out → back button does not reveal cached
  financial data.
- **Dependency audit:** `npm audit --audit-level=high` fails the build.

---

## 9. Future: bank SMS privacy requirements

These are binding constraints on Milestone 12, recorded now because v1 violated four of the six and
the code is still in the repository.

1. **Never log the message body.** v1: `Log.i(TAG, "…| message=$body")` wrote complete bank SMS —
   account fragments, balances, merchant history — to Logcat, readable during any debugging session
   and by anything with log access on older devices. Not "log less"; **never**.
2. **Never persist the message body.** v1 stored `messageBody` in an unencrypted Room database.
   The parser output is `{ amountMinor, occurredOn, merchantRaw, last4, bankCode, confidence }`.
   The body is discarded when the parse function returns.
3. **Never transmit the body.** Parsing is on-device. Only extracted fields sync.
4. **Encrypt what little is stored locally.** SQLCipher or `EncryptedSharedPreferences` for the
   pending-review queue.
5. **Least-privilege permission.** `RECEIVE_SMS` is a Google Play *restricted* permission requiring
   a declaration and an approved use case. **Action for Milestone 0: remove `RECEIVE_SMS` and the
   receiver from the manifest**, since the feature is not built and its presence alone risks
   rejection of any store submission. Ask for it at the moment the user opts in, explain why, and
   let the app work fully without it.
6. **Never auto-trust a parse.** Every ingested row lands as `pending_review` and requires an
   explicit user confirmation before it affects a single number.

Plus the receiver hardening from T19: require `BROADCAST_SMS` on the receiver and allow-list sender
addresses, so another app cannot inject fabricated transactions.

---

## 10. Incident response

| Situation | Response |
|---|---|
| **Anon key leaked** | It is public by design — it grants nothing beyond RLS. No action beyond confirming RLS coverage. |
| **`service_role` key leaked** | Rotate immediately in the Supabase dashboard; redeploy Edge Functions and CI secrets; audit `audit_log` and Supabase logs for the exposure window. |
| **Cross-tenant data exposure found** | Disable the affected route via a feature flag; add the missing policy; add the case to the RLS matrix *before* the fix; determine the affected window from Supabase logs; notify affected users. |
| **Money inconsistency reported** | `audit_log` plus the append-only `goal_contributions` and `gamification_events` ledgers make the true value recoverable. `recompute_goal_totals()` repairs caches. This is why the ledgers are append-only. |
| **Dependency advisory** | Dependabot PR, CI, expedited review; if actively exploited, patch and deploy same-day. |

Every one of these depends on being able to *reconstruct history*, which is why append-only ledgers
and `audit_log` are security architecture, not conveniences.
