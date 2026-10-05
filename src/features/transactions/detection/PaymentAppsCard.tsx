import { BellRing } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { SmsCaptureStatus } from '@/platform/sms/smsCapture'

/**
 * Payment-app notifications as a second source — its own Prominent Disclosure
 * (Google Play User Data policy), because Notification access is broad:
 * Android shows an app with it every notification on the phone. The card says
 * so, and says which apps are read. Only "Agree and open settings" leads to
 * Android's Notification access screen, where the user grants it.
 */

/** The apps whose notifications are read — android/…/sms/PaymentApps.java. */
const APPS =
  'Google Pay, PhonePe, Paytm, BHIM, CRED, MobiKwik and Freecharge, and the SBI, ICICI, HDFC, Axis and Kotak apps'

export interface PaymentAppsCardProps {
  readonly status: SmsCaptureStatus
  readonly busy: boolean
  readonly onAgree: () => void
  readonly onTurnOff: () => void
  readonly onOpenAccess: () => void
}

export function PaymentAppsCard({
  status,
  busy,
  onAgree,
  onTurnOff,
  onOpenAccess,
}: PaymentAppsCardProps) {
  const [declined, setDeclined] = useState(false)
  if (!status.enabled || declined) return null

  if (status.paymentApps && status.notificationAccess) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-text">
          <span className="font-medium">Payment apps are on.</span> Payments from their
          notifications are added like bank SMS — once, even when both arrive.
        </p>
        <div>
          <Button variant="ghost" size="sm" onClick={onTurnOff} disabled={busy}>
            Turn off
          </Button>
        </div>
      </Card>
    )
  }

  if (status.paymentApps) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-text">
          One more step: allow Notification access for Money Matters in Android settings.
        </p>
        <p className="text-sm text-text-muted">
          If Android calls it a restricted setting — it does for apps not installed from an app
          store — open Settings → Apps → Money Matters, tap ⋮ and choose Allow restricted settings
          first.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onOpenAccess}>
            Open settings
          </Button>
          <Button variant="ghost" size="sm" onClick={onTurnOff} disabled={busy}>
            Not now
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
          <BellRing className="size-5" />
        </span>
        <h2 className="text-lg font-semibold text-text">Add payments from payment apps</h2>
      </div>
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="font-medium text-text">Why</dt>
          <dd className="text-text-muted">
            Some banks no longer text you about small UPI payments. Payment apps still notify you,
            so Money Matters can add those payments too.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-text">What it reads</dt>
          <dd className="text-text-muted">
            Notifications from {APPS}. Android shows an app with Notification access every
            notification on your phone; Money Matters ignores all the others without reading them.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-text">How it is used</dt>
          <dd className="text-text-muted">
            Exactly like bank SMS: read on this phone and thrown away. Clear payments are added, the
            rest wait for you, and only the amount, payee, date and category are saved. A payment
            that also arrives by SMS is added once.
          </dd>
        </div>
      </dl>
      <p className="text-sm text-text-muted">
        Android will open its Notification access screen; turn on Money Matters there.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onAgree} loading={busy}>
          Agree and open settings
        </Button>
        <Button variant="secondary" onClick={() => setDeclined(true)} disabled={busy}>
          Not now
        </Button>
      </div>
    </Card>
  )
}
