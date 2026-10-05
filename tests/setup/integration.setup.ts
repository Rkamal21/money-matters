import { beforeAll } from 'vitest'

import { assertLocal, connect, DATABASE_URL } from '../integration/db'

/**
 * Fail fast, and fail clearly, when the database is not up.
 *
 * A suite that silently skips because Docker is not running is worse than a red
 * one: it looks green in CI on the day the migrations stop applying.
 */
beforeAll(async () => {
  assertLocal(DATABASE_URL)

  const sql = connect()
  try {
    await sql`select 1`
  } catch (cause) {
    throw new Error(
      `Cannot reach the local Supabase database at ${DATABASE_URL}.\n` +
        'Run `npm run db:start` (Docker must be running), then `npm run db:reset`.',
      { cause },
    )
  } finally {
    await sql.end({ timeout: 5 })
  }
}, 60_000)
