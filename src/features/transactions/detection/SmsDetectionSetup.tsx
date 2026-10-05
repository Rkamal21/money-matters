import { MessageSquareText } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Switch } from '@/components/ui/SegmentedControl'
import type { SmsCaptureStatus } from '@/platform/sms/smsCapture'

/**
 * Turning SMS detection on — Google Play's "Prominent Disclosure and Consent"
 * rule: this screen comes first, says why, what and how in plain words, and
 * offers two choices. Only "Agree and turn on" leads to Android's permission
 * prompt. A refusal is not asked again; the screen explains where to change it.
 *
 * Once on, the user decides whether clear transactions are added automatically
 * (ADR-0015 as amended on 2026-10-04) — the disclosure says that they are.
 */

export interface SmsDetectionSetupProps {
  readonly status: SmsCaptureStatus
  readonly busy: boolean
  readonly onAgree: () => void
  readonly onTurnOff: () => void
  readonly onOpenSettings: () => void
  readonly onAutoAdd: (enabled: boolean) => void
}

export function SmsDetectionSetup({
  status,
  busy,
  onAgree,
  onTurnOff,
  onOpenSettings,
  onAutoAdd,
}: SmsDetectionSetupProps) {
  const [declined, setDeclined] = useState(false)

  if (status.unavailable === 'not_android') {
    return (
      <Card>
        <p className="text-sm text-text-muted">
          Detecting transactions from bank SMS works in the Money Matters Android app.
        </p>
      </Card>
    )
  }

  if (status.unavailable === 'unsupported_device') {
    return (
      <Card>
        <p className="text-sm text-text-muted">
          This phone cannot run SMS detection: it needs Android 8 or later with an up-to-date
          Android System WebView. You can still add every transaction by hand.
        </p>
      </Card>
    )
  }

  if (status.enabled) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-text">
          <span className="font-medium">SMS detection is on.</span> Bank and UPI messages are read
          on this phone; only the amount, payee, date and category reach your account.
        </p>
        <Switch
          checked={status.autoAdd}
          onChange={onAutoAdd}
          disabled={busy}
          label="Add clear transactions automatically"
          description="When the amount, payee, category and account are all certain and nothing like it is recorded yet. You get a notification with Undo. Anything else waits here for you."
        />
        {status.notifications !== 'granted' ? (
          <p className="text-sm text-text-muted">
            Notifications are off, so you will not hear about added or detected transactions — check
            here and in Transactions.
          </p>
        ) : null}
        <div>
          <Button variant="ghost" size="sm" onClick={onTurnOff} disabled={busy}>
            Turn off
          </Button>
        </div>
      </Card>
    )
  }

  if (status.sms === 'denied') {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-text">
          SMS access is turned off for Money Matters, so transactions will not be detected. You can
          still add them by hand.
        </p>
        <p className="text-sm text-text-muted">
          To change this, open Android Settings → Apps → Money Matters → Permissions → SMS.
        </p>
        <p className="text-sm text-text-muted">
          If Android calls it a restricted setting — it does for apps not installed from an app
          store — open the same Money Matters page, tap ⋮ and choose Allow restricted settings
          first.
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={onOpenSettings}>
            Open app settings
          </Button>
        </div>
      </Card>
    )
  }

  if (declined) {
    return (
      <Card>
        <p className="text-sm text-text-muted">
          SMS detection stays off. You can turn it on here whenever you like.
        </p>
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
          <MessageSquareText className="size-5" />
        </span>
        <h2 className="text-lg font-semibold text-text">Add transactions from bank SMS</h2>
      </div>
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium text-text">Why</dt>
          <dd className="text-text-muted">
            So you do not have to type your payments. When your bank or UPI app texts you about a
            payment, Money Matters adds it for you — or asks you, when something is unclear.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-text">What it reads</dt>
          <dd className="text-text-muted">
            The text of SMS messages you receive from banks and payment services. Messages from
            people are ignored.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-text">How it is used</dt>
          <dd className="text-text-muted">
            Each message is read on this phone and then thrown away. A transaction whose amount,
            merchant, category and account are all clear is added automatically, with a notification
            you can undo — you can turn this off. Anything unclear waits for you to confirm. Only
            the amount, merchant, date and category are saved to your Money Matters account. The SMS
            itself is never uploaded or stored.
          </dd>
        </div>
      </dl>
      <p className="text-sm text-text-muted">
        Android will ask you to allow SMS access and notifications. You can turn this off at any
        time on this screen.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAgree} loading={busy}>
          Agree and turn on
        </Button>
        <Button variant="secondary" onClick={() => setDeclined(true)} disabled={busy}>
          Not now
        </Button>
      </div>
    </Card>
  )
}
