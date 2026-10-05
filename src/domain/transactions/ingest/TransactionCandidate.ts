import type { Money } from '../../money/Money'
import type { LocalDate } from '../../period/LocalDate'
import type { CategorySuggestion } from '../categorize/CategoryRule'
import type { TransactionKind } from '../types'

/**
 * What the ingestion parser hands on — ARCHITECTURE.md §M.3, ROADMAP.md M12.
 *
 *   raw message → parser → TransactionCandidate → (later) review → ledger
 *
 * A candidate is a suggestion, never a transaction: nothing here is written
 * anywhere, and on its way to the ledger it must pass an explicit user
 * confirmation (SECURITY.md §9 rule 6). It carries extracted fields only — the
 * message body is not part of it, so it cannot be logged or stored by accident
 * (SECURITY.md §9 rules 1–3).
 */

/** Which way the money moved for the user. `unknown` is never treated as an expense. */
export type CandidateDirection = 'expense' | 'income' | 'unknown'

/** The ledger kind a candidate would be saved as. A refund is money in, filed under an expense category. */
export type CandidateKind = Extract<TransactionKind, 'expense' | 'income' | 'refund'>

/** One piece of evidence and what it is worth. The score is the sum, so it explains itself. */
export type ConfidenceFactor =
  'amount' | 'direction' | 'merchant' | 'category' | 'reference' | 'account' | 'date'

export interface ConfidenceItem {
  readonly factor: ConfidenceFactor
  readonly points: number
}

export interface CandidateConfidence {
  /** 0–100: points for evidence found in the message. A checklist, not a probability. */
  readonly score: number
  readonly level: 'high' | 'medium' | 'low'
  /** Only the factors that scored, in a fixed order. */
  readonly breakdown: readonly ConfidenceItem[]
}

/**
 * The key a later duplicate check compares (DATABASE.md `dedupe_hash`). Built
 * from extracted fields — never from the message body.
 *
 *   reference       the bank's own transaction reference was found
 *   message         no reference, but the SMS centre's send time: one SMS, one key —
 *                   a re-delivery shares it, an identically worded second payment does not
 *   fields          amount, direction, date, merchant and account
 *   fields_undated  as above with no date: a weak key, which a review must treat as such
 */
export type FingerprintBasis = 'reference' | 'message' | 'fields' | 'fields_undated'

export interface TransactionFingerprint {
  /** SHA-256 of the canonical key, as 64 lower-case hex characters. */
  readonly value: string
  readonly basis: FingerprintBasis
}

export interface TransactionCandidate {
  /** Always positive: direction says which way, never a sign (DATABASE.md `amount_minor`). */
  readonly amount: Money
  readonly direction: CandidateDirection
  /** `null` while the direction is unknown: a person decides. */
  readonly kind: CandidateKind | null
  /** Display name — the rule's label ("Swiggy"), or the payee tidied up. */
  readonly merchant: string | null
  /** The payee exactly as the message wrote it, for categorisation and review. */
  readonly merchantRaw: string | null
  readonly occurredOn: LocalDate | null
  /** `message` when the text carries a date; `received` when it fell back to the arrival date. */
  readonly occurredOnSource: 'message' | 'received' | null
  /** 24-hour "HH:MM" when the message gives a time. Informational, like `occurred_at`. */
  readonly occurredTime: string | null
  /** The bank's reference (UPI RRN, UTR, Ref No), upper-cased. */
  readonly reference: string | null
  /** The masked account or card digits the message shows ("XX1234" → "1234"). */
  readonly accountLast4: string | null
  /** From the existing merchant rules, and only for a category of the right kind. */
  readonly category: CategorySuggestion | null
  readonly confidence: CandidateConfidence
  readonly fingerprint: TransactionFingerprint
}

/** Why a message produced no candidate. A reason, never the text. */
export type RejectionReason =
  | 'empty'
  | 'too_long'
  | 'otp'
  | 'promotional'
  | 'failed'
  | 'not_completed'
  | 'no_amount'
  | 'balance_only'
  | 'insufficient_evidence'

export type ParseMessageResult =
  | { readonly status: 'candidate'; readonly candidate: TransactionCandidate }
  | { readonly status: 'rejected'; readonly reason: RejectionReason }
