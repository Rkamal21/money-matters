import { Navigate, Outlet, useLocation } from 'react-router'

import { ErrorState } from '@/components/ui/States'
import { Splash } from '@/components/ui/Splash'
import { useProfile } from '@/data/queries'
import { needsOnboarding } from '@/domain/profile/Profile'
import { toAppError } from '@/lib/errors'
import { useSession } from '@/lib/session'

/**
 * Route guards. These are USER EXPERIENCE only — the data is protected by
 * RLS, and someone who defeats a guard sees an empty page, not somebody
 * else's money (SECURITY.md §3).
 */

export function RequireAuth() {
  const session = useSession()
  const location = useLocation()

  if (session.status === 'loading') return <Splash />
  if (session.status === 'signed_out') {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />
  }
  return <Outlet />
}

/** Sends a signed-in user to onboarding until `onboarding_completed_at` is set (PRODUCT.md §8). */
export function RequireOnboarding() {
  const profile = useProfile()

  if (profile.isPending) return <Splash label="Loading your profile" />
  if (profile.isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState error={toAppError(profile.error)} onRetry={() => void profile.refetch()} />
      </div>
    )
  }
  if (needsOnboarding(profile.data)) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/** Public pages (sign in, sign up) bounce a signed-in user onward. */
export function PublicOnly() {
  const session = useSession()
  const location = useLocation()

  if (session.status === 'loading') return <Splash />
  if (session.status === 'signed_in' && !session.recovering) {
    const returnTo = new URLSearchParams(location.search).get('returnTo')
    const safe =
      returnTo !== null && returnTo.startsWith('/') && !returnTo.startsWith('//')
        ? returnTo
        : '/dashboard'
    return <Navigate to={safe} replace />
  }
  return <Outlet />
}
