import { ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import {
  useAccounts,
  useCategories,
  useMerchantRules,
  usePreferences,
  useToday,
} from '@/data/queries'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { useUserId } from '@/lib/session'

import { DetectionWorkbench } from './DetectionWorkbench'
import { splitMessages } from './reviewDraft'

/**
 * `/dev/transaction-detection` — registered only in development builds
 * (app/router.tsx), so neither the route nor this chunk exists in production.
 */
export function TransactionDetectionDevPage() {
  usePageTitle('Transaction detection')
  const userId = useUserId()
  const today = useToday()
  const { currency, locale } = usePreferences()
  const accounts = useAccounts()
  const categories = useCategories()
  const rules = useMerchantRules()

  const error = accounts.error ?? categories.error ?? rules.error
  if (error) {
    return (
      <ErrorState
        error={toAppError(error)}
        onRetry={() =>
          void Promise.all([accounts.refetch(), categories.refetch(), rules.refetch()])
        }
      />
    )
  }
  if (
    today === null ||
    accounts.data === undefined ||
    categories.data === undefined ||
    rules.data === undefined
  ) {
    return (
      <LoadingBlock label="Loading">
        <Skeleton className="h-40 w-full" />
      </LoadingBlock>
    )
  }

  return (
    <DetectionWorkbench
      userId={userId}
      accounts={accounts.data}
      categories={categories.data}
      rules={rules.data}
      today={today}
      currency={currency}
      locale={locale}
      loadLocalMessages={loadLocalMessages}
    />
  )
}

/**
 * Reads bank-messages.local through the dev server's `/__dev/bank-messages`
 * (vite.config.ts), which answers this computer only and never caches. The
 * reasons below never include any of the file's text.
 */
async function loadLocalMessages(): Promise<string[]> {
  const response = await fetch('/__dev/bank-messages', { cache: 'no-store' })
  if (response.status === 403) {
    throw new Error(
      'bank-messages.local is served to this computer only. Open the app at http://localhost:5173.',
    )
  }
  if (response.status === 404) {
    throw new Error('bank-messages.local was not found in the project folder.')
  }
  if (!response.ok) throw new Error('Could not load bank-messages.local.')
  return splitMessages(await response.text())
}
