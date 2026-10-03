import type { Money } from '../../money/Money'
import { type LocalDate, toISO } from '../../period/LocalDate'
import { normalizeMerchant } from '../categorize/normalizeMerchant'

import { sha256Hex } from './sha256'
import type { CandidateDirection, TransactionFingerprint } from './TransactionCandidate'

/**
 * The duplicate key for an ingested transaction — DATABASE.md `dedupe_hash`
 * and §"Duplicate SMS/import".
 *
 * Built from extracted fields, never from the message text, so one transaction
 * gets one key whether it arrives as an SMS, a re-delivered SMS or, later, a
 * statement row:
 *
 *   with a reference   v1|ref|<REFERENCE>|<direction>|<CUR>:<minor>
 *   without one        v1|fields|<direction>|<CUR>:<minor>|<date>|<merchant>|<last4>
 *
 * Choices that keep the key stable:
 *   - The amount and direction stay in the reference key, because a reversal
 *     or refund often quotes the original transaction's reference.
 *   - The time of day is left out: a statement row rarely has one, and the key
 *     has to match across sources.
 *   - The merchant is the normalised text, not a rule's label, so editing a
 *     rule can never change an existing key.
 *
 * The key is versioned. Changing its shape means `v2`, never an edit of `v1`,
 * or every stored hash silently stops matching.
 */

export interface FingerprintInput {
  readonly amount: Money
  readonly direction: CandidateDirection
  readonly reference: string | null
  readonly occurredOn: LocalDate | null
  readonly merchantRaw: string | null
  readonly accountLast4: string | null
}

const MISSING = '-'

export function fingerprintKey(input: FingerprintInput): string {
  const amount = `${input.amount.currency}:${input.amount.minor}`
  if (input.reference !== null) {
    return ['v1', 'ref', input.reference.toUpperCase(), input.direction, amount].join('|')
  }
  const merchant = normalizeMerchant(input.merchantRaw ?? '')
  return [
    'v1',
    'fields',
    input.direction,
    amount,
    input.occurredOn === null ? MISSING : toISO(input.occurredOn),
    merchant === '' ? MISSING : merchant,
    input.accountLast4 ?? MISSING,
  ].join('|')
}

export function fingerprintOf(input: FingerprintInput): TransactionFingerprint {
  return {
    value: sha256Hex(fingerprintKey(input)),
    basis:
      input.reference !== null
        ? 'reference'
        : input.occurredOn !== null
          ? 'fields'
          : 'fields_undated',
  }
}
