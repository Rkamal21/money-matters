import type { Money } from '../../money/Money'
import { daysBetween, type LocalDate } from '../../period/LocalDate'
import { normalizeMerchant } from '../categorize/normalizeMerchant'
import type { Transaction, TransactionKind } from '../types'

import type { TransactionFingerprint } from './TransactionCandidate'

/**
 * Between a candidate and the ledger: the two duplicate checks the review step
 * makes before a person confirms (ROADMAP.md M12 "Duplicate detection: exact
 * and fuzzy"). Pure — the caller fetches, these decide.
 */

const FINGERPRINT = /^[0-9a-f]{64}$/

/**
 * The confirmation's idempotency key: the candidate's fingerprint, as a UUID.
 *
 * The ledger already refuses a second row with the same `client_request_id`
 * (`UNIQUE (user_id, client_request_id)`, DATABASE.md §12), and the repository
 * answers that refusal with the row already saved. A key derived from the
 * fingerprint, instead of one generated per submission, turns that existing
 * guard into the exact duplicate check: the same bank message — re-delivered,
 * pasted twice, or written by another bank with the same reference — can never
 * become two rows. It comes from the message, not from the reviewed values, so
 * editing a field before confirming does not dodge it.
 *
 * Layout: RFC 9562 version 8 ("custom"), the first 122 bits of the SHA-256 with
 * the version and variant bits set.
 */
export function confirmationRequestId(fingerprint: TransactionFingerprint): string {
  const hex = fingerprint.value
  if (!FINGERPRINT.test(hex)) throw new RangeError('Expected a SHA-256 fingerprint.')
  const variant = ((parseInt(hex.charAt(16), 16) & 0b0011) | 0b1000).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Why an existing transaction looks like the one about to be added. */
export type SimilarityReason =
  'same_amount' | 'same_type' | 'same_day' | 'one_day_apart' | 'same_account' | 'same_merchant'

export interface SimilarityProbe {
  readonly amount: Money
  readonly kind: TransactionKind
  readonly occurredOn: LocalDate
  readonly accountId: string
  readonly merchant: string | null
}

export interface SimilarTransaction {
  readonly transaction: Transaction
  readonly reasons: readonly SimilarityReason[]
}

/** How far apart two dates may be and still be one payment (DATABASE.md's fuzzy window). */
export const SIMILAR_WITHIN_DAYS = 1

/**
 * Transactions already in the ledger that could be this one: the same amount
 * and type within a day. A match is a warning for a person to weigh — a manual
 * entry of the same payment, or a second ₹40 chai — never a refusal. Strongest
 * first: more reasons, then the closer date.
 */
export function findSimilarTransactions(
  probe: SimilarityProbe,
  existing: readonly Transaction[],
): SimilarTransaction[] {
  const merchant = normalizeMerchant(probe.merchant ?? '')
  return existing
    .filter(
      (transaction) =>
        transaction.deletedAt === null &&
        transaction.kind === probe.kind &&
        transaction.amount.currency === probe.amount.currency &&
        transaction.amount.minor === probe.amount.minor &&
        Math.abs(daysBetween(transaction.occurredOn, probe.occurredOn)) <= SIMILAR_WITHIN_DAYS,
    )
    .map((transaction) => {
      const sameDay = daysBetween(transaction.occurredOn, probe.occurredOn) === 0
      const reasons: SimilarityReason[] = [
        'same_amount',
        'same_type',
        sameDay ? 'same_day' : 'one_day_apart',
      ]
      if (transaction.accountId === probe.accountId) reasons.push('same_account')
      if (merchant !== '' && namesMerchant(transaction, merchant)) reasons.push('same_merchant')
      return { transaction, reasons, sameDay }
    })
    .sort(
      (a, b) =>
        b.reasons.length - a.reasons.length ||
        Number(b.sameDay) - Number(a.sameDay) ||
        a.transaction.id.localeCompare(b.transaction.id),
    )
    .map(({ transaction, reasons }) => ({ transaction, reasons }))
}

/** "Swiggy" matches a row labelled "Swiggy" or described as "Swiggy dinner". */
function namesMerchant(transaction: Transaction, merchant: string): boolean {
  return [transaction.merchantLabel ?? '', transaction.description].some((text) => {
    const normalized = normalizeMerchant(text)
    return normalized !== '' && (normalized.includes(merchant) || merchant.includes(normalized))
  })
}
