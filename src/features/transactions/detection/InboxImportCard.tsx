import { Inbox } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { ImportCounts, SmsCaptureStatus } from '@/platform/sms/smsCapture'

/**
 * "Import past messages" — its own Prominent Disclosure (Google Play User
 * Data policy), because it asks for a second permission, READ_SMS, to read
 * what is already in the inbox. Only "Agree and import" leads to Android's
 * prompt.
 */

/** How far back an import reads. */
export const IMPORT_DAYS = 90

export interface ImportSummary {
  readonly counts: ImportCounts
  /** Of the new ones: added automatically, and left for review. */
  readonly added: number
  readonly waiting: number
}

export interface InboxImportCardProps {
  readonly status: SmsCaptureStatus
  readonly busy: boolean
  readonly summary: ImportSummary | null
  readonly onAgree: () => void
  readonly onOpenSettings: () => void
}

export function InboxImportCard({
  status,
  busy,
  summary,
  onAgree,
  onOpenSettings,
}: InboxImportCardProps) {
  const [declined, setDeclined] = useState(false)
  if (!status.enabled || declined) return null

  if (busy) {
    return (
      <Card>
        <p role="status" className="text-sm text-text">
          Reading your bank messages from the last {IMPORT_DAYS} days…
        </p>
      </Card>
    )
  }

  if (summary !== null) {
    const { counts, added, waiting } = summary
    return (
      <Card className="flex flex-col gap-1">
        <p role="status" className="text-sm font-medium text-text">
          {counts.queued === 0
            ? `No new transactions in the last ${IMPORT_DAYS} days.`
            : `Found ${counts.queued} new ${counts.queued === 1 ? 'transaction' : 'transactions'}: ${added} added, ${waiting} waiting for you below.`}
        </p>
        <p className="text-sm text-text-muted">
          Read {counts.fromBanks} bank {counts.fromBanks === 1 ? 'message' : 'messages'}
          {counts.alreadyFound > 0 ? `; ${counts.alreadyFound} were already recorded` : ''}. Your
          account balances stay as you entered them.
        </p>
      </Card>
    )
  }

  if (status.inbox === 'denied') {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-text">
          Reading past messages is turned off for Money Matters. New messages are still detected.
        </p>
        <p className="text-sm text-text-muted">
          To change this, open Android Settings → Apps → Money Matters → Permissions → SMS.
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={onOpenSettings}>
            Open app settings
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand"
        >
          <Inbox className="size-5" />
        </span>
        <h2 className="text-lg font-semibold text-text">Import past messages</h2>
      </div>
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium text-text">Why</dt>
          <dd className="text-text-muted">
            To add the payments you made before turning detection on, so this month’s spending and
            budgets are complete.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-text">What it reads</dt>
          <dd className="text-text-muted">
            The bank and payment SMS already in your inbox from the last {IMPORT_DAYS} days.
            Messages from people are skipped.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-text">How it is used</dt>
          <dd className="text-text-muted">
            The same way as new messages: read on this phone, never uploaded or stored. Clear
            transactions are added; the rest wait here for you. Payments from before you created an
            account count towards its opening balance, so your balances stay as you entered them.
          </dd>
        </div>
      </dl>
      <p className="text-sm text-text-muted">Android will ask you to allow access to your SMS.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAgree}>Agree and import</Button>
        <Button variant="secondary" onClick={() => setDeclined(true)}>
          Not now
        </Button>
      </div>
    </Card>
  )
}
