import { type Money, toMajorString } from '@/domain/money/Money'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'

/**
 * The notification for a detected transaction. It says what was found — an
 * amount and, if known, who — and nothing else from the message: no account
 * digits, no reference, no balance. On a locked screen only `publicText`
 * shows (SECURITY.md §9).
 *
 * Two kinds: "detected …" for one waiting for review, and "added …" for one
 * added automatically (domain/transactions/ingest/autoAdd.ts), which carries
 * an Undo.
 *
 * Formatting is done by hand rather than with `Intl`, because this runs inside
 * Android's JavaScriptSandbox, where `Intl` is not guaranteed.
 */

export interface DetectionNotice {
  readonly title: string
  readonly text: string
  readonly publicText: string
}

export const NOTICE_TITLE = 'Transaction detected'
export const NOTICE_PUBLIC_TEXT = 'Money Matters found a transaction to review.'
export const ADDED_TITLE = 'Transaction added'
export const ADDED_PUBLIC_TEXT = 'Money Matters added a transaction.'

/** "₹1,23,456.50" for rupees, "USD 1,234.50" for anything else. */
export function noticeAmount(money: Money): string {
  const [whole = '', fraction] = toMajorString(money).split('.')
  const indian = money.currency === 'INR'
  const grouped =
    indian && whole.length > 3
      ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',')},${whole.slice(-3)}`
      : whole.replace(/\B(?=(\d{3})+$)/g, ',')
  const figure = fraction === undefined ? grouped : `${grouped}.${fraction}`
  return indian ? `₹${figure}` : `${money.currency} ${figure}`
}

export function noticeFor(candidate: TransactionCandidate): DetectionNotice {
  const amount = noticeAmount(candidate.amount)
  const who = candidate.merchant
  let text: string
  switch (candidate.kind) {
    case 'expense':
      text = who === null ? `a ${amount} payment` : `a ${amount} payment at ${who}`
      break
    case 'income':
      text = who === null ? `a ${amount} credit` : `a ${amount} credit from ${who}`
      break
    case 'refund':
      text = who === null ? `a ${amount} refund` : `a ${amount} refund from ${who}`
      break
    case null:
      text = `a ${amount} transaction. Tap to review it`
      break
  }
  return {
    title: NOTICE_TITLE,
    text: `Money Matters detected ${text}.`,
    publicText: NOTICE_PUBLIC_TEXT,
  }
}

/** "Money Matters added a ₹486 payment at Swiggy to Food." Only for a detection with a type and a payee. */
export function addedNoticeFor(
  candidate: TransactionCandidate,
  categoryName: string,
): DetectionNotice {
  const amount = noticeAmount(candidate.amount)
  const who = candidate.merchant ?? 'an unknown payee'
  const what =
    candidate.kind === 'income'
      ? `a ${amount} credit from ${who}`
      : candidate.kind === 'refund'
        ? `a ${amount} refund from ${who}`
        : `a ${amount} payment at ${who}`
  return {
    title: ADDED_TITLE,
    text: `Money Matters added ${what} to ${categoryName}.`,
    publicText: ADDED_PUBLIC_TEXT,
  }
}
