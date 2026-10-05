import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import {
  useAccounts,
  useCategories,
  useInvalidateLedger,
  useMerchantRules,
  usePreferences,
  useToday,
} from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'
import type { Transaction } from '@/domain/transactions/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'
import { type Detection, type DetectionSource, smsCapture } from '@/platform/sms/smsCapture'

import { autoAddDetections, exclusively } from './autoAdd'
import { IMPORT_DAYS, InboxImportCard, type ImportSummary } from './InboxImportCard'
import { PaymentAppsCard } from './PaymentAppsCard'
import { ReviewCandidate } from './ReviewCandidate'
import { SmsDetectionSetup } from './SmsDetectionSetup'

/**
 * `/detected` and `/detected/:id` — transactions found in bank SMS (ROADMAP.md
 * M12). Clear ones are added automatically by DetectionListener (./autoAdd.ts);
 * what is left here needs a person, and reaches the ledger only through
 * ReviewCandidate's "Confirm & Add" — the entry form's own write path.
 * Confirmed, merged into a transfer or ignored, it leaves the device queue.
 *
 * The page also turns detection on, sets automatic adding, and imports past
 * messages from the inbox.
 */

const SOURCE_LABEL: Readonly<Record<DetectionSource, string>> = {
  sms: 'Bank SMS',
  notification: 'Payment app',
  import: 'From your inbox',
}

const KIND_LABEL: Readonly<Record<NonNullable<TransactionCandidate['kind']>, string>> = {
  expense: 'Payment',
  income: 'Money received',
  refund: 'Refund',
}

export function DetectedTransactionsPage() {
  const { id } = useParams()
  usePageTitle(id === undefined ? 'Detected transactions' : 'Review transaction')
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const invalidateLedger = useInvalidateLedger()
  const userId = useUserId()
  const today = useToday()
  const { currency, locale } = usePreferences()
  const accounts = useAccounts()
  const categories = useCategories()
  const rules = useMerchantRules()

  const status = useQuery({
    queryKey: [...queryKeys.smsDetections(), 'status'],
    queryFn: () => smsCapture.status(),
  })
  const detections = useQuery({
    queryKey: queryKeys.smsDetections(),
    queryFn: () => smsCapture.listPending(),
    enabled: status.data?.available === true,
  })

  const refreshStatus = (next: Awaited<ReturnType<typeof smsCapture.status>>) =>
    queryClient.setQueryData([...queryKeys.smsDetections(), 'status'], next)
  const enable = useMutation({ mutationFn: () => smsCapture.enable(), onSuccess: refreshStatus })
  const disable = useMutation({
    mutationFn: async () => {
      await smsCapture.disable()
      return smsCapture.status()
    },
    onSuccess: refreshStatus,
  })
  const autoAdd = useMutation({
    mutationFn: (enabled: boolean) => smsCapture.setAutoAdd(enabled),
    onSuccess: refreshStatus,
  })
  const paymentApps = useMutation({
    mutationFn: (enabled: boolean) => smsCapture.setPaymentApps(enabled),
    onSuccess: refreshStatus,
  })

  const imported = useMutation({
    mutationFn: async (): Promise<ImportSummary | null> => {
      const current = status.data
      if (current === undefined || today === null) return null
      const access = current.inbox === 'granted' ? 'granted' : await smsCapture.requestInbox()
      if (access !== 'granted') return null
      const counts = await smsCapture.importInbox(IMPORT_DAYS)
      const result = await exclusively(() =>
        autoAddDetections(
          {
            userId,
            accounts: accounts.data ?? [],
            categories: categories.data ?? [],
            rules: rules.data ?? [],
            today,
            currency,
            enabled: current.autoAdd,
          },
          { repositories, capture: smsCapture },
        ),
      )
      const fromInbox = (detection: Detection) => detection.source === 'import'
      return {
        counts,
        added: result.added.filter(({ detection }) => fromInbox(detection)).length,
        waiting: result.held.filter(({ detection }) => fromInbox(detection)).length,
      }
    },
    onSettled: async () => {
      await Promise.all([
        invalidateLedger(),
        queryClient.invalidateQueries({ queryKey: queryKeys.smsDetections() }),
      ])
    },
  })

  const ignoreImported = useMutation({
    mutationFn: async (ids: readonly string[]) => {
      for (const detectionId of ids) await smsCapture.remove(detectionId)
    },
    onSuccess: async (_, ids) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.smsDetections() })
      toast.show({ tone: 'info', title: `Ignored ${ids.length}. Nothing was saved.` })
    },
  })

  const settle = async (detectionId: string) => {
    await smsCapture.remove(detectionId)
  }

  /**
   * After "Confirm & Add": the row's origin first — for an imported message it
   * also keeps today's balance — and only then out of the queue. If recording
   * fails, the detection stays queued and the next automatic pass finishes it.
   */
  const confirmed = async (detection: Detection, saved: Transaction) => {
    try {
      await repositories.transactions.recordOrigin(
        saved.id,
        detection.source,
        detection.source === 'import' ? detection.sentAt : null,
      )
      await smsCapture.remove(detection.id)
    } catch {
      // Left for the next pass.
    }
  }

  const error =
    status.error ?? detections.error ?? accounts.error ?? categories.error ?? rules.error
  if (error) {
    return <ErrorState error={toAppError(error)} onRetry={() => void status.refetch()} />
  }
  if (
    status.data === undefined ||
    today === null ||
    accounts.data === undefined ||
    categories.data === undefined ||
    rules.data === undefined ||
    (status.data.available && detections.data === undefined)
  ) {
    return (
      <LoadingBlock label="Loading detected transactions">
        <Skeleton className="h-32 w-full" />
      </LoadingBlock>
    )
  }

  const pending = detections.data ?? []

  if (id !== undefined) {
    const detection = pending.find((item) => item.id === id)
    if (detection === undefined) {
      return (
        <EmptyState
          title="This transaction is no longer waiting"
          body="It was already added or ignored."
          action={
            <Link to="/detected" className="font-medium text-brand hover:underline">
              See detected transactions
            </Link>
          }
        />
      )
    }
    return (
      <div className="flex flex-col gap-4">
        <Link to="/detected" className="text-sm font-medium text-brand hover:underline">
          ← Detected transactions
        </Link>
        <Card>
          <ReviewCandidate
            candidate={detection.candidate}
            userId={userId}
            accounts={accounts.data}
            categories={categories.data}
            rules={rules.data}
            today={today}
            currency={currency}
            locale={locale}
            rejectLabel="Ignore"
            onAdded={(saved) => void confirmed(detection, saved)}
            onMerged={() => void settle(detection.id)}
            onRejected={() => {
              void settle(detection.id).then(async () => {
                await queryClient.invalidateQueries({ queryKey: queryKeys.smsDetections() })
                toast.show({ tone: 'info', title: 'Ignored. Nothing was saved.' })
                void navigate('/detected', { replace: true })
              })
            }}
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Detected transactions</h1>
        <p className="text-sm text-text-muted">
          Found in your bank and UPI messages. Clear ones are added for you; the ones below need a
          quick look.
        </p>
      </header>

      <SmsDetectionSetup
        status={status.data}
        busy={enable.isPending || disable.isPending || autoAdd.isPending}
        onAgree={() => enable.mutate()}
        onTurnOff={() => disable.mutate()}
        onOpenSettings={() => void smsCapture.openAppSettings()}
        onAutoAdd={(enabled) => autoAdd.mutate(enabled)}
      />

      <PaymentAppsCard
        status={status.data}
        busy={paymentApps.isPending}
        onAgree={() => paymentApps.mutate(true)}
        onTurnOff={() => paymentApps.mutate(false)}
        onOpenAccess={() => void smsCapture.openNotificationAccess()}
      />

      <InboxImportCard
        status={status.data}
        busy={imported.isPending}
        summary={imported.data ?? null}
        onAgree={() => imported.mutate()}
        onOpenSettings={() => void smsCapture.openAppSettings()}
      />
      {imported.isError ? (
        <ErrorState error={toAppError(imported.error)} title="Could not import messages" compact />
      ) : null}

      {status.data.available ? (
        pending.length === 0 ? (
          <EmptyState
            title="Nothing to review"
            body="New bank and UPI transactions will appear here as they arrive."
          />
        ) : (
          <section aria-labelledby="pending-heading" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 id="pending-heading" className="text-sm font-medium text-text-muted">
                Waiting for review ({pending.length})
              </h2>
              {pending.some((detection) => detection.source === 'import') ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={ignoreImported.isPending}
                  onClick={() =>
                    ignoreImported.mutate(
                      pending
                        .filter((detection) => detection.source === 'import')
                        .map((detection) => detection.id),
                    )
                  }
                >
                  Ignore all from inbox
                </Button>
              ) : null}
            </div>
            <Card className="p-0 sm:p-0">
              <ul className="divide-y divide-border">
                {pending.map((detection) => (
                  <DetectionRow key={detection.id} detection={detection} locale={locale} />
                ))}
              </ul>
            </Card>
          </section>
        )
      ) : null}
    </div>
  )
}

function DetectionRow({
  detection,
  locale,
}: {
  readonly detection: Detection
  readonly locale: string
}) {
  const { candidate } = detection
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    detection.receivedAt,
  )
  return (
    <li>
      <Link
        to={`/detected/${detection.id}`}
        className="flex min-h-16 items-center gap-3 px-4 hover:bg-surface-2/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">
            {candidate.kind === null ? 'Needs a type' : KIND_LABEL[candidate.kind]}
            {candidate.merchant === null ? '' : ` · ${candidate.merchant}`}
          </span>
          <span className="block truncate text-xs text-text-muted">
            {SOURCE_LABEL[detection.source]} · {when}
          </span>
        </span>
        <Money value={candidate.amount} locale={locale} className="font-medium" />
        <ChevronRight aria-hidden="true" className="size-5 text-text-muted" />
      </Link>
    </li>
  )
}
