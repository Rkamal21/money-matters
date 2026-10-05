import { z } from 'zod'

import { fromMinor, MAX_ABS_MINOR } from '@/domain/money/Money'
import { tryFromISO } from '@/domain/period/LocalDate'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'

/**
 * `CandidateJSON` back into a `TransactionCandidate`. The queue lives in device
 * storage, so what comes out of it is checked like any other untrusted input
 * (API.md §4): a record that does not parse is dropped, never half-used.
 */

const text = z.string().max(200)
const nullableText = text.nullable()

const suggestion = z.object({
  categorySlug: z.string().regex(/^[a-z0-9_]{1,40}$/),
  merchantLabel: z.string().max(80),
  confidence: z.number().min(0).max(1),
  ruleId: z.string().max(200),
  source: z.enum(['user', 'system']),
  pattern: z.string().max(100),
  matchType: z.enum(['contains', 'prefix', 'exact']),
})

const schema = z.object({
  amount: z.object({
    minor: z.string().regex(/^\d{1,15}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  direction: z.enum(['expense', 'income', 'unknown']),
  kind: z.enum(['expense', 'income', 'refund']).nullable(),
  merchant: nullableText,
  merchantRaw: nullableText,
  occurredOn: z.string().nullable(),
  occurredOnSource: z.enum(['message', 'received']).nullable(),
  occurredTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  reference: nullableText,
  accountLast4: z
    .string()
    .regex(/^\d{3,4}$/)
    .nullable(),
  category: suggestion.nullable(),
  confidence: z.object({
    score: z.number().int().min(0).max(100),
    level: z.enum(['high', 'medium', 'low']),
    breakdown: z.array(
      z.object({
        factor: z.enum([
          'amount',
          'direction',
          'merchant',
          'category',
          'reference',
          'account',
          'date',
        ]),
        points: z.number().int().min(0).max(100),
      }),
    ),
  }),
  fingerprint: z.object({
    value: z.string().regex(/^[0-9a-f]{64}$/),
    basis: z.enum(['reference', 'message', 'fields', 'fields_undated']),
  }),
})

export function candidateFromJSON(value: unknown): TransactionCandidate | null {
  const parsed = schema.safeParse(value)
  if (!parsed.success) return null
  const json = parsed.data
  const minor = BigInt(json.amount.minor)
  if (minor <= 0n || minor >= MAX_ABS_MINOR) return null
  const occurredOn = json.occurredOn === null ? null : tryFromISO(json.occurredOn)
  if (json.occurredOn !== null && occurredOn === null) return null
  return {
    amount: fromMinor(minor, json.amount.currency),
    direction: json.direction,
    kind: json.kind,
    merchant: json.merchant,
    merchantRaw: json.merchantRaw,
    occurredOn,
    occurredOnSource: json.occurredOnSource,
    occurredTime: json.occurredTime,
    reference: json.reference,
    accountLast4: json.accountLast4,
    category: json.category,
    confidence: json.confidence,
    fingerprint: json.fingerprint,
  }
}
