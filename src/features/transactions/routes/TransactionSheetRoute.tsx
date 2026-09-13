import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router'

import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import {
  useAccounts,
  useCategories,
  useMerchantRules,
  usePreferences,
  useToday,
} from '@/data/queries'
import { repositories } from '@/data/repositories'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

import { TransactionForm } from '../components/TransactionForm'

/**
 * `/transactions/new` and `/transactions/:id/edit`, as a sheet over the page
 * they were opened from. Closing goes back, so the browser and the Android
 * back button both do the expected thing.
 */
export function TransactionSheetRoute() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const hasBackground = Boolean((location.state as { background?: unknown } | null)?.background)
  const userId = useUserId()
  const today = useToday()
  const { currency, locale } = usePreferences()
  const accounts = useAccounts()
  const categories = useCategories()
  const rules = useMerchantRules()

  const existing = useQuery({
    queryKey: queryKeys.transaction(id ?? 'new'),
    enabled: id !== undefined,
    queryFn: () => repositories.transactions.getById(userId, id ?? ''),
  })

  const close = () => {
    if (hasBackground) void navigate(-1)
    else void navigate('/transactions', { replace: true })
  }

  const loading =
    today === null ||
    accounts.isPending ||
    categories.isPending ||
    (id !== undefined && existing.isPending)
  const error = accounts.error ?? categories.error ?? existing.error

  let body
  if (error) {
    body = (
      <ErrorState
        error={toAppError(error)}
        onRetry={() =>
          void Promise.all([accounts.refetch(), categories.refetch(), existing.refetch()])
        }
      />
    )
  } else if (loading || today === null) {
    body = (
      <LoadingBlock label="Loading the form">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </LoadingBlock>
    )
  } else if (id !== undefined && existing.data === null) {
    // Missing and someone else's look identical: never reveal which (API.md §5.2).
    body = <EmptyState title="This transaction is not available" body="It may have been deleted." />
  } else if ((accounts.data ?? []).length === 0) {
    body = (
      <EmptyState
        title="Add an account first"
        body="Every transaction happens in an account — cash, a bank account, a card."
        action={
          <button
            type="button"
            className="font-medium text-brand hover:underline"
            onClick={() => void navigate('/settings/accounts')}
          >
            Add an account
          </button>
        }
      />
    )
  } else {
    body = (
      <TransactionForm
        key={existing.data?.id ?? 'new'}
        userId={userId}
        existing={existing.data ?? null}
        accounts={accounts.data ?? []}
        categories={categories.data ?? []}
        rules={rules.data ?? []}
        today={today}
        currency={currency}
        locale={locale}
        onDone={close}
      />
    )
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
      title={id === undefined ? 'Add transaction' : 'Edit transaction'}
    >
      {body}
    </Sheet>
  )
}
