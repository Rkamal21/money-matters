import type { TransactionCandidate } from './TransactionCandidate'

/**
 * One payment, two messages: a UPI payment usually brings the bank's SMS and
 * the payment app's notification, worded differently and with no reference in
 * common — so their fingerprints differ, and each alone would be added. Pure:
 * Android keeps the recent captures (encrypted, no text) and asks, inside the
 * sandbox, whether a new message is the other half of one of them.
 *
 * The match is one-to-one: a capture pairs with at most one capture from the
 * other source. Two ₹20 chais a minute apart — two SMS and two notifications —
 * stay two payments; only an SMS and a notification can be one.
 */

export type LiveSource = 'sms' | 'notification'

/** What Android remembers about a message it captured — figures only, never text. */
export interface RecentCapture {
  readonly source: LiveSource
  readonly direction: 'expense' | 'income'
  /** The amount in minor units, as a decimal string (JSON has no bigint). */
  readonly amountMinor: string
  readonly currency: string
  /** When the message was sent, epoch ms. */
  readonly at: number
  readonly fingerprint: string
  /** Already paired with a capture from the other source. */
  readonly paired: boolean
}

/** How far apart the SMS and the notification of one payment may be sent. */
export const SAME_PAYMENT_WITHIN_MS = 15 * 60 * 1000

/** How long a capture is worth remembering. */
export const RECENT_FOR_MS = 24 * 60 * 60 * 1000

export function captureOf(
  candidate: TransactionCandidate,
  source: LiveSource,
  at: number,
): RecentCapture | null {
  if (candidate.direction === 'unknown') return null
  return {
    source,
    direction: candidate.direction,
    amountMinor: candidate.amount.minor.toString(),
    currency: candidate.amount.currency,
    at,
    fingerprint: candidate.fingerprint.value,
    paired: false,
  }
}

/**
 * The unpaired capture from the other source that this message repeats — same
 * direction, same amount, sent within fifteen minutes — or `null`. The closest
 * in time wins.
 */
export function samePayment(
  candidate: TransactionCandidate,
  source: LiveSource,
  at: number,
  recent: readonly RecentCapture[],
): RecentCapture | null {
  const capture = captureOf(candidate, source, at)
  if (capture === null) return null
  const matches = recent
    .filter(
      (other) =>
        !other.paired &&
        other.source !== source &&
        other.direction === capture.direction &&
        other.currency === capture.currency &&
        other.amountMinor === capture.amountMinor &&
        Math.abs(other.at - at) <= SAME_PAYMENT_WITHIN_MS,
    )
    .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))
  return matches[0] ?? null
}
