import { createContext, useContext } from 'react'

/**
 * The auth session as the rest of the app sees it — ARCHITECTURE.md §J, one of
 * the two genuinely global contexts. The provider lives in `app/`; the
 * context lives here so every layer below `app/` can read it.
 *
 * `loading` exists so no route ever renders in an indeterminate auth state:
 * v1 briefly reported "signed out" on every reload and flashed the login
 * screen at signed-in users (SECURITY.md §3).
 */
export interface SessionUser {
  readonly userId: string
  readonly email: string | null
}

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed_out' }
  | { readonly status: 'signed_in'; readonly user: SessionUser; readonly recovering: boolean }

export const SessionContext = createContext<SessionState>({ status: 'loading' })

export function useSession(): SessionState {
  return useContext(SessionContext)
}

/** For code that only renders behind `RequireAuth`. */
export function useUserId(): string {
  const session = useSession()
  if (session.status !== 'signed_in') {
    throw new Error('useUserId() called outside an authenticated route.')
  }
  return session.user.userId
}
