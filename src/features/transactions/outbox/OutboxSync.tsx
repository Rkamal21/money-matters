import { CloudOff, TriangleAlert } from 'lucide-react'
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/Button'
import { Money } from '@/components/ui/Money'
import { useToast } from '@/components/ui/Toast'
import { useInvalidateLedger, usePreferences } from '@/data/queries'
import { repositories } from '@/data/repositories'
import { useUserId } from '@/lib/session'
import { onAppResume } from '@/platform/app/lifecycle'

import { outbox, type OutboxEntry } from './outbox'
import { replayOutbox } from './replay'

const subscribe = (listener: () => void) => outbox.subscribe(listener)
const snapshot = () => outbox.snapshot()

/** While something is queued, try again this often, besides on reconnect and resume. */
const RETRY_MS = 30_000

/**
 * Mounted once inside the signed-in layout. Writes the transactions saved
 * while offline as soon as it can — on opening the app, on the browser's
 * `online` event, on coming back to the foreground, and every 30 seconds while
 * any are waiting — and says what is waiting and what could not be added.
 */
export function OutboxSync() {
  const userId = useUserId()
  const toast = useToast()
  const invalidateLedger = useInvalidateLedger()
  const { locale } = usePreferences()
  const all = useSyncExternalStore(subscribe, snapshot)
  const mine = useMemo(() => all.filter((entry) => entry.request.userId === userId), [all, userId])
  const waiting = mine.filter((entry) => entry.failure === null)
  const failed = mine.filter((entry) => entry.failure !== null)
  const running = useRef(false)
  const [syncing, setSyncing] = useState(false)
  const [attempts, setAttempts] = useState(0)

  const sync = useEffectEvent(async () => {
    if (running.current) return
    running.current = true
    setSyncing(true)
    try {
      const result = await replayOutbox(userId, outbox, repositories)
      if (result.added > 0) {
        await invalidateLedger()
        toast.show({
          tone: 'success',
          title:
            result.added === 1
              ? 'Added the transaction you saved offline'
              : `Added ${result.added} transactions you saved offline`,
        })
      }
    } finally {
      running.current = false
      setSyncing(false)
    }
  })

  useEffect(() => {
    void sync()
    const onOnline = () => void sync()
    window.addEventListener('online', onOnline)
    const stopResume = onAppResume(() => void sync())
    return () => {
      window.removeEventListener('online', onOnline)
      stopResume()
    }
  }, [userId])

  // "Try now".
  useEffect(() => {
    if (attempts > 0) void sync()
  }, [attempts])

  const hasWaiting = waiting.length > 0
  useEffect(() => {
    if (!hasWaiting) return
    const timer = window.setInterval(() => void sync(), RETRY_MS)
    return () => window.clearInterval(timer)
  }, [hasWaiting])

  if (waiting.length === 0 && failed.length === 0) return null

  return (
    <div className="mb-4 flex flex-col gap-3">
      {waiting.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-card-border bg-surface p-4 shadow-card"
        >
          <CloudOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">
              {waiting.length === 1
                ? '1 transaction saved on this device'
                : `${waiting.length} transactions saved on this device`}
            </p>
            <p className="text-sm text-text-muted">
              {outbox.durable
                ? 'It will be added to your ledger when you are back online.'
                : 'It will be added when you are back online. Keep this tab open until then.'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={syncing}
            onClick={() => setAttempts((count) => count + 1)}
          >
            Try now
          </Button>
        </div>
      )}
      {failed.map((entry) => (
        <FailedEntry key={entry.id} entry={entry} locale={locale} />
      ))}
    </div>
  )
}

function FailedEntry({ entry, locale }: { readonly entry: OutboxEntry; readonly locale: string }) {
  const { transaction } = entry.request
  const label = transaction.description?.trim() || 'A transaction'
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-2xl border border-negative/30 bg-surface p-4 shadow-card"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-negative" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">
          {label} · <Money value={transaction.amount} locale={locale} /> could not be added
        </p>
        <p className="text-sm text-text-muted">{entry.failure?.message}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void outbox.remove(entry.id)}>
        Discard
      </Button>
    </div>
  )
}
