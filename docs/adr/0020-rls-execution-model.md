# ADR-0020 — The RLS execution model: `FORCE`, `BYPASSRLS`, and trigger privileges

Status: **Accepted** · Date: 2026-09-08 · Verified against PostgreSQL 15.19 and
`supabase/postgres:15.8.1.060`

## Context

Three documents made claims about how server-side writes interact with Row-Level Security, and none
of them had been tested:

- [SECURITY.md §4.1](../SECURITY.md) justified `FORCE ROW LEVEL SECURITY` on the grounds that
  without it "a `SECURITY DEFINER` function owned by that role would silently bypass every policy".
- [DATABASE.md §10](../DATABASE.md) listed `sync_goal_saved()` and `enforce_split_total()` as plain
  triggers, while [SECURITY.md §4.4](../SECURITY.md) revokes from `authenticated` exactly the
  columns those triggers write.
- Five functions (`handle_new_user`, `award_xp`, `audit_row`, and the two above) write tables that
  have no permissive policy and, for three of them, no grant at all.

These cannot all be true at once. A spike settled it.

## Verified behaviour

Run against a clean PostgreSQL 15 with a non-superuser owner role, then against Supabase's own
image for the role attributes:

| # | Setup | Result |
|---|---|---|
| 1 | `SECURITY DEFINER` insert into a `FORCE`d table with no policy, owner without `BYPASSRLS` | `42501` — **`FORCE` does apply to the definer's owner** |
| 2 | Same, owner granted `BYPASSRLS` | Succeeds — **`BYPASSRLS` defeats `FORCE`** |
| 3 | Plain (invoker) trigger updating a column revoked from the caller | `42501`, and the user's whole write rolls back |
| 4 | `SECURITY DEFINER` trigger, owner without `BYPASSRLS`, no policy for that owner | **No error. Zero rows updated. The cached total is silently wrong** |
| 5 | Same, but the definer reads the ledger to recompute | The `SELECT` is RLS-filtered too — it sees **zero rows** and would write `0` |
| 6 | Definer + `SELECT` *and* `UPDATE` policies for the owner on the target, and `SELECT` on every table it reads | Correct total. Policies alone are sufficient |
| 7 | Drop only the owner's `SELECT` policy on the write target | Silently stops updating again — `UPDATE … WHERE` needs to *see* the row |
| 8 | `supabase/postgres`: `select rolname, rolsuper, rolbypassrls from pg_roles` | `postgres` → `rolsuper = f`, **`rolbypassrls = t`**; `service_role` → `t`; `authenticated`, `anon`, `supabase_auth_admin` → `f` |

Two of these were not what the design assumed. An under-privileged definer function **fails
silently on `UPDATE`** rather than erroring, and a definer function's **reads** are policed as well
as its writes — so a recompute does not merely fail to write, it computes the wrong answer from an
empty ledger.

## Decision

1. **Keep `FORCE ROW LEVEL SECURITY` on every table**, and correct its stated rationale. It does not
   prevent a `SECURITY DEFINER` bypass. What it buys is that an owner *without* `BYPASSRLS` — a
   future dedicated maintenance role, a self-hosted deployment, a migration run as a different
   role — is still policed.
2. **Server-side writes run as `postgres`, which holds `BYPASSRLS`.** That is the fact that makes
   trigger-maintained columns work under `FORCE`. It is now written down, and asserted in CI,
   because it is load-bearing and invisible.
3. **Any trigger function that writes a column absent from the caller's grant is
   `SECURITY DEFINER`**, with `SET search_path = ''` and fully-qualified names. That is
   `sync_goal_saved()`, `enforce_split_total()`, `award_xp()`, `audit_row()` and
   `handle_new_user()`. `set_updated_at()` and the validation triggers stay invoker: they assign
   `NEW` or raise, and neither requires a column privilege.
4. **CI asserts the model**, because every failure mode above is silent: every `SECURITY DEFINER`
   function in `public` must be owned by a role with `rolbypassrls`, and the functions in (3) must
   have `prosecdef` set.

## Alternatives

1. **Explicit policies `TO` the owner role** on every server-written table, instead of relying on
   `BYPASSRLS`.
2. **Drop `FORCE`** on server-written tables and carve them out of the CI assertion.
3. **Leave it undocumented** and rely on it working.

## Reasoning

Option 1 is the more principled design and was the initial recommendation: every write path becomes
visible in `pg_policy`, which is what the CI checks already read. Test 6 confirms it works. It was
rejected on cost and on failure mode — it needs *three* policies per server-written table (`SELECT`
and `UPDATE` on the target, `SELECT` on every table the function reads), the requirement is
non-obvious in exactly the way that produces test 7, and getting it wrong is silent. It remains the
migration path if we ever move off a `BYPASSRLS` owner, and this ADR is where that cost is recorded.

Option 2 weakens the invariant that makes the §8.2 assertion meaningful — "every table in `public`
is forced" is checkable; "every table except these five" drifts.

Option 3 is what we had. The cost of rediscovering it is a wrong number in production with no error
in any log.

## Tradeoffs

- **A platform role attribute is load-bearing.** If Supabase ever ships `postgres` without
  `BYPASSRLS`, every recompute in the system goes stale silently. Mitigated by the CI assertion,
  which fails the build rather than the data.
- **`FORCE` now buys less than the documents claimed.** Stated plainly rather than quietly kept.
- **Changing a function's owner is a breaking change** with no error message. Called out in the
  Definition of Done and in [TESTING.md §4.5](../TESTING.md), which includes a deliberate
  revoke-and-observe regression test.

## Consequences

- [DATABASE.md §10](../DATABASE.md) gains a **Security** column: attribute, owner and grants for
  every function. It is the reference for this ADR, not prose.
- [SECURITY.md §4.5](../SECURITY.md) gains rules 6 and 7 covering triggers and definer reads.
- [SECURITY.md §8.2](../SECURITY.md) gains the owner assertion and the `prosecdef` assertion.
- Two of the four existing CI schema queries were also schema-filtered while here: they read
  `pg_policy` unrestricted and would have matched Supabase's own `auth`, `storage` and `realtime`
  policies, failing the build on day one for reasons unrelated to our schema.
