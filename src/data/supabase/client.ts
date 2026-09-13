import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { env } from '@/config/env'

import type { Database } from './database.types'

/**
 * The Supabase client. This directory is the only place in the repository that
 * imports it — features and components are lint-banned from doing so
 * (ARCHITECTURE.md §G.1, eslint.config.js).
 *
 * The anon key is public by design; RLS is what protects the data
 * (SECURITY.md §1). `config/env.ts` has already refused a service-role key.
 */
export type Db = SupabaseClient<Database>

export const supabase: Db = createClient<Database>(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Email confirmation and password-reset links land back on the app with a
      // token in the URL; the client exchanges it for a session.
      detectSessionInUrl: true,
    },
  },
)
