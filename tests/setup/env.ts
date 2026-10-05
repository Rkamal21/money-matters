import { vi } from 'vitest'

/**
 * Deterministic configuration for every test run.
 *
 * `src/config/env.ts` validates at module load and throws when a variable is
 * missing, which is the behaviour we want in production and a flake in CI —
 * where there is no `.env` file. Stubbing here means a test never depends on a
 * developer's local file, and never accidentally points at a real project.
 */
export const TEST_SUPABASE_URL = 'http://127.0.0.1:54321'

/** A structurally valid anon JWT. Signature is meaningless; nothing verifies it. */
export const TEST_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS10ZXN0Iiwicm9sZSI6ImFub24ifQ.test-signature'

export function stubTestEnv(): void {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? TEST_SUPABASE_URL)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? TEST_ANON_KEY)
  // No DSN: Sentry must never initialise in a test run.
  vi.stubEnv('VITE_SENTRY_DSN', '')
}
