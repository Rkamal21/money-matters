import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { usePreferences } from '@/data/queries'

const subscribe = (listener: () => void) => onlineManager.subscribe(listener)
const isOnline = () => onlineManager.isOnline()

/**
 * The staleness marker (ARCHITECTURE.md §M.2, §R.9): with no connection the
 * app shows what this device last loaded, and says so, with the time — so an
 * old balance is never mistaken for today's.
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, isOnline)
  const queryClient = useQueryClient()
  const { locale } = usePreferences()
  if (online) return null

  const loadedAt = Math.max(
    0,
    ...queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.dataUpdatedAt),
  )
  // The day as well as the time: a copy can be days old.
  const when =
    loadedAt === 0
      ? null
      : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
          loadedAt,
        )

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-2xl border border-card-border bg-surface-2 p-4"
    >
      <WifiOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-text-muted" />
      <p className="text-sm text-text">
        <span className="font-medium">You are offline.</span>{' '}
        {when === null
          ? 'Nothing has loaded on this device yet.'
          : `Showing what this device last loaded, at ${when}. New transactions are saved here until you are back online.`}
      </p>
    </div>
  )
}
