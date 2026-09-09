import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect } from './db'

/**
 * Milestone 0's integration test: the migrations apply from zero, and the
 * schema-level security assertions in SECURITY.md §8.2 all hold.
 *
 * At M0 most of those assertions are vacuously true — there are no tables yet.
 * That is the point of running them now rather than in M1: the query, the
 * schema filter and the CI wiring are proven while the answer is obviously
 * "empty", so the first time one goes red it is because a policy is actually
 * wrong.
 *
 * **Every query is filtered to `nspname = 'public'`.** Supabase ships `FOR ALL`
 * policies and `SECURITY DEFINER` functions in `auth`, `storage` and
 * `realtime` that we neither own nor may change; an unfiltered assertion fails
 * the build on day one and gets deleted, which is worse than not having it.
 * SECURITY.md §8.2 says so twice, in the two places it bites.
 */

let sql: postgres.Sql

beforeAll(() => {
  sql = connect()
})

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

describe('migrations applied from zero', () => {
  it('installed the extensions the later milestones depend on', async () => {
    const rows = await sql<{ extname: string }[]>`
      select extname from pg_extension
       where extname in ('pgcrypto', 'btree_gist', 'pg_trgm')
    `

    expect(rows.map((row) => row.extname).sort()).toEqual(['btree_gist', 'pg_trgm', 'pgcrypto'])
  })

  it('created every enum type from DATABASE.md §5', async () => {
    const rows = await sql<{ typname: string }[]>`
      select t.typname
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typtype = 'e'
       order by t.typname
    `

    expect(rows.map((row) => row.typname)).toEqual([
      'account_type',
      'category_kind',
      'category_treatment',
      'contribution_source',
      'gamification_event_type',
      'match_type',
      'transaction_kind',
      'transaction_source',
      'transaction_status',
    ])
  })

  it('does not define a regex match type (ADR-0022)', async () => {
    const [row] = await sql<{ labels: string[] }[]>`
      select array_agg(e.enumlabel order by e.enumsortorder) as labels
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
       where t.typname = 'match_type'
    `

    expect(row?.labels).not.toContain('regex')
  })

  it('created no tables yet, because M0 provisions the database and nothing more', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
    `

    expect(rows).toEqual([])
  })
})

describe('SECURITY.md §8.2 schema assertions (public schema only)', () => {
  it('every table in public has RLS enabled and forced', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (not c.relrowsecurity or not c.relforcerowsecurity)
    `

    expect(rows.map((row) => row.relname)).toEqual([])
  })

  it('every view in public is security_invoker', async () => {
    const rows = await sql<{ relname: string }[]>`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'
         and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%'
    `

    expect(rows.map((row) => row.relname)).toEqual([])
  })

  it('has no FOR ALL policies in public', async () => {
    const rows = await sql<{ polname: string }[]>`
      select pol.polname
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and pol.polcmd = '*'
    `

    expect(rows.map((row) => row.polname)).toEqual([])
  })

  it('every UPDATE/INSERT policy in public has a WITH CHECK', async () => {
    const rows = await sql<{ polname: string }[]>`
      select pol.polname
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and pol.polcmd in ('w', 'a') and pol.polwithcheck is null
    `

    expect(rows.map((row) => row.polname)).toEqual([])
  })

  it('no SECURITY DEFINER function in public without a pinned search_path', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%'
    `

    expect(rows.map((row) => row.proname)).toEqual([])
  })

  it('every SECURITY DEFINER function is owned by a role that bypasses RLS (ADR-0020)', async () => {
    const rows = await sql<{ proname: string; rolname: string }[]>`
      select p.proname, r.rolname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_roles r on r.oid = p.proowner
       where n.nspname = 'public' and p.prosecdef and not r.rolbypassrls
    `

    expect(rows).toEqual([])
  })

  it('no client-callable function takes a user id (§4.5 rule 2)', async () => {
    const rows = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and has_function_privilege('authenticated', p.oid, 'execute')
         and pg_get_function_identity_arguments(p.oid) ~ 'p_user_id|user_id uuid'
    `

    expect(rows.map((row) => row.proname)).toEqual([])
  })

  it('every trigger function that writes a protected column is SECURITY DEFINER (§4.5 rule 6)', async () => {
    // Maintained as an explicit list because "writes a protected column" is not
    // introspectable. Names come from SECURITY.md §8.2; none exist yet.
    const rows = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not p.prosecdef
         and p.proname in (
           'sync_goal_saved', 'enforce_split_total', 'award_xp',
           'audit_row', 'handle_new_user', 'evaluate_achievements'
         )
    `

    expect(rows.map((row) => row.proname)).toEqual([])
  })
})

describe('the assertions are scoped to schemas we own', () => {
  /**
   * The guard on the guard.
   *
   * Every assertion above is filtered to `public`. These two tests demonstrate
   * why by showing what the same queries find outside it: if a future edit
   * drops a `nspname = 'public'` clause, the suite goes red for reasons nobody
   * is allowed to fix, and the usual outcome is that the assertion gets deleted
   * rather than the filter restored.
   *
   * The counts are asserted as "more than zero", not as exact numbers, because
   * they belong to Supabase and change with the CLI version.
   */
  it('managed schemas hold tables without forced RLS, which unfiltered assertion 1 would flag', async () => {
    const [row] = await sql<{ managed: number }[]>`
      select count(*)::int as managed
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('auth', 'storage', 'realtime')
         and c.relkind = 'r'
         and (not c.relrowsecurity or not c.relforcerowsecurity)
    `

    expect(row?.managed ?? 0).toBeGreaterThan(0)
  })

  it('so does pg_catalog, which is why "every table" can never mean every table', async () => {
    const [row] = await sql<{ managed: number }[]>`
      select count(*)::int as managed
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('pg_catalog', 'information_schema')
         and c.relkind = 'r'
         and (not c.relrowsecurity or not c.relforcerowsecurity)
    `

    expect(row?.managed ?? 0).toBeGreaterThan(0)
  })
})
