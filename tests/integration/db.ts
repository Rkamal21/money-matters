import postgres from 'postgres'

/**
 * Direct Postgres access for the integration and RLS suites.
 *
 * The RLS matrix (TESTING.md §4.1) and the schema assertions (SECURITY.md §8.2)
 * both need to see the database as Postgres sees it — policies, ownership,
 * `search_path` — which PostgREST deliberately does not expose. So these suites
 * connect straight to the local instance the Supabase CLI started.
 *
 * This is local-only by construction: the default is 127.0.0.1 and
 * `assertLocal` refuses anything else. A remote connection string here would be
 * a suite that mutates a real project.
 */
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

export const DATABASE_URL = process.env['SUPABASE_DB_URL'] ?? DEFAULT_URL

export function assertLocal(url: string): void {
  const host = new URL(url).hostname
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== 'db') {
    throw new Error(
      `Refusing to run the integration suite against ${host}. ` +
        'These tests reset and mutate data; point SUPABASE_DB_URL at a local Supabase.',
    )
  }
}

export function connect(): postgres.Sql {
  assertLocal(DATABASE_URL)
  return postgres(DATABASE_URL, { max: 4, onnotice: () => {} })
}
