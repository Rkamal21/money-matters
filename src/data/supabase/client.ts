import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { env, IS_DEV } from '@/config/env'

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

const isLoopback = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/**
 * In development the app may be opened from a phone on the local network
 * (`npm run dev -- --host`). The configured URL points at 127.0.0.1 — which,
 * on the phone, is the phone — so the local Supabase is reached through the
 * address the page itself was loaded from. Production builds drop this branch.
 */
function supabaseUrl(): string {
  const configured = env.VITE_SUPABASE_URL
  if (!IS_DEV) return configured
  const url = new URL(configured)
  if (!isLoopback(url.hostname) || isLoopback(window.location.hostname)) return configured
  url.hostname = window.location.hostname
  return url.toString().replace(/\/$/, '')
}

export const supabase: Db = createClient<Database>(supabaseUrl(), env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Email confirmation and password-reset links land back on the app with a
    // token in the URL; the client exchanges it for a session.
    detectSessionInUrl: true,
  },
})
