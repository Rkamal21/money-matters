import { toISO } from '@/domain/period/LocalDate'
import type { CategorySuggestion } from '@/domain/transactions/categorize/CategoryRule'
import type {
  CandidateConfidence,
  CandidateDirection,
  CandidateKind,
  TransactionCandidate,
  TransactionFingerprint,
} from '@/domain/transactions/ingest/TransactionCandidate'

/**
 * A candidate as JSON — how it crosses the native boundary and how it waits,
 * encrypted, in the device's review queue. `Money.minor` is a bigint, which
 * JSON cannot carry, so it travels as a decimal string; a date travels as ISO.
 *
 * Extracted fields only, like the candidate itself: the message body is never
 * part of it (SECURITY.md §9).
 */
export interface CandidateJSON {
  readonly amount: { readonly minor: string; readonly currency: string }
  readonly direction: CandidateDirection
  readonly kind: CandidateKind | null
  readonly merchant: string | null
  readonly merchantRaw: string | null
  readonly occurredOn: string | null
  readonly occurredOnSource: 'message' | 'received' | null
  readonly occurredTime: string | null
  readonly reference: string | null
  readonly accountLast4: string | null
  readonly category: CategorySuggestion | null
  readonly confidence: CandidateConfidence
  readonly fingerprint: TransactionFingerprint
}

export function candidateToJSON(candidate: TransactionCandidate): CandidateJSON {
  return {
    amount: { minor: candidate.amount.minor.toString(), currency: candidate.amount.currency },
    direction: candidate.direction,
    kind: candidate.kind,
    merchant: candidate.merchant,
    merchantRaw: candidate.merchantRaw,
    occurredOn: candidate.occurredOn === null ? null : toISO(candidate.occurredOn),
    occurredOnSource: candidate.occurredOnSource,
    occurredTime: candidate.occurredTime,
    reference: candidate.reference,
    accountLast4: candidate.accountLast4,
    category: candidate.category,
    confidence: candidate.confidence,
    fingerprint: candidate.fingerprint,
  }
}
