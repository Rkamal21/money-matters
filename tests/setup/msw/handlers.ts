import { http, HttpResponse } from 'msw'

import { TEST_SUPABASE_URL } from '../env'

/**
 * Default handlers, shared by every component test.
 *
 * Deliberately thin at Milestone 0: there are no tables yet, so the only thing
 * worth stubbing is the PostgREST root. Per-entity handlers arrive with the
 * repositories they belong to, and a test that needs a specific response
 * overrides these with `server.use(...)`.
 */
export const handlers = [
  http.get(`${TEST_SUPABASE_URL}/rest/v1/`, () =>
    HttpResponse.json({ swagger: '2.0', info: { title: 'standard public schema' } }),
  ),
]
