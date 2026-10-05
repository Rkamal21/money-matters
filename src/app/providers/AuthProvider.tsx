import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'

import { repositories } from '@/data/repositories'
import { SessionContext, type SessionState } from '@/lib/session'

/**
 * One deterministic initialisation (SECURITY.md §3): render a splash until
 * `getSession()` resolves once, then follow `onAuthStateChange`.
 *
 * Signing out — or a different user signing in — clears the whole query
 * cache. Leaving one user's balances in memory for the next person on a
 * shared device is a data-exposure bug, not a caching detail (API.md §2.1).
 */
export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    let recovering = false
    let currentUserId: string | null = null

    const signedIn = (userId: string, email: string | null) => {
      if (currentUserId !== null && currentUserId !== userId) queryClient.clear()
      currentUserId = userId
      setState((previous) =>
        previous.status === 'signed_in' &&
        previous.user.userId === userId &&
        previous.recovering === recovering
          ? previous
          : { status: 'signed_in', user: { userId, email }, recovering },
      )
    }

    const signedOut = () => {
      currentUserId = null
      recovering = false
      queryClient.clear()
      setState({ status: 'signed_out' })
    }

    repositories.auth
      .getSession()
      .then((session) => {
        if (!active) return
        if (session === null) signedOut()
        else signedIn(session.userId, session.email)
      })
      .catch(() => {
        if (active) signedOut()
      })

    const unsubscribe = repositories.auth.onChange((event, session) => {
      if (!active || event === 'INITIAL_SESSION') return
      if (event === 'PASSWORD_RECOVERY') recovering = true
      if (event === 'USER_UPDATED') recovering = false
      if (session === null) signedOut()
      else signedIn(session.userId, session.email)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [queryClient])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}
