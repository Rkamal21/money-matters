import { tryFromISO } from '@/domain/period/LocalDate'
import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import {
  type AutoAddAccount,
  autoAddCategory,
  candidateHolds,
} from '@/domain/transactions/ingest/autoAdd'
import { parseTransactionMessage } from '@/domain/transactions/ingest/parseTransactionMessage'
import { confirmationRequestId } from '@/domain/transactions/ingest/review'
import {
  captureOf,
  type LiveSource,
  type RecentCapture,
  samePayment,
} from '@/domain/transactions/ingest/samePayment'
import type { RejectionReason } from '@/domain/transactions/ingest/TransactionCandidate'
import type { CategoryKind } from '@/domain/transactions/types'

import { type CandidateJSON, candidateToJSON } from './candidateJson'
import { addedNoticeFor, type DetectionNotice, noticeFor } from './notice'

/**
 * The one function Android calls (android/…/sms/TransactionDetector), inside a
 * JavaScriptSandbox, the moment a bank SMS or payment-app notification arrives
 * — including when the app is not running. It runs the same
 * `parseTransactionMessage` the app uses; there is no second parser.
 *
 * In: JSON `{ text, sentAt, receivedOn, rules, categories, currency, accounts,
 * autoAdd, source, recent }`. Out: JSON with the candidate, its confirmation
 * key, whether it can be added without review (domain/transactions/ingest/
 * autoAdd.ts), the notification to match, and — for a live message — the
 * figures Android should remember and the earlier capture from the other
 * source it repeats, if any (samePayment.ts). Or the rejection reason. The
 * text goes no further than this function (SECURITY.md §9).
 */

export interface BridgeCategory {
  readonly slug: string
  readonly kind: CategoryKind
  readonly name?: string
  readonly isArchived?: boolean
}

export interface BridgeInput {
  readonly text: string
  /** When the message was sent (SMS centre time, or the notification's time), epoch ms. */
  readonly sentAt?: number
  /** The arrival date in the device's zone, YYYY-MM-DD. */
  readonly receivedOn?: string
  readonly rules?: readonly CategoryRule[]
  readonly categories?: readonly BridgeCategory[]
  /** The ledger's currency; without it nothing is added automatically. */
  readonly currency?: string
  readonly accounts?: readonly AutoAddAccount[]
  /** The user's "Add clear transactions automatically" switch. */
  readonly autoAdd?: boolean
  /** Where the text came from; an inbox import is not matched across sources. */
  readonly source?: LiveSource | 'import'
  /** What Android remembers of the last day's live captures. */
  readonly recent?: readonly RecentCapture[]
}

export type BridgeOutput =
  | {
      readonly status: 'candidate'
      readonly candidate: CandidateJSON
      /** The ledger idempotency key: confirming or adding it twice writes one row. */
      readonly requestId: string
      /** Nothing in the message needs a person; the app still checks the ledger before adding. */
      readonly auto: boolean
      readonly notice: DetectionNotice
      /** For a live message: the figures to remember, to pair it with its other half later. */
      readonly capture: RecentCapture | null
      /** The fingerprint of the earlier capture, from the other source, this message repeats. */
      readonly samePaymentAs: string | null
    }
  | { readonly status: 'rejected'; readonly reason: RejectionReason }
  | { readonly status: 'error' }

export function parseForNative(inputJson: string): string {
  let output: BridgeOutput
  try {
    const input = JSON.parse(inputJson) as Partial<BridgeInput>
    const receivedOn = typeof input.receivedOn === 'string' ? tryFromISO(input.receivedOn) : null
    const categories: readonly BridgeCategory[] = Array.isArray(input.categories)
      ? input.categories
      : []
    const result = parseTransactionMessage({
      text: typeof input.text === 'string' ? input.text : '',
      rules: Array.isArray(input.rules) ? input.rules : [],
      categories,
      ...(receivedOn === null ? {} : { receivedOn }),
      ...(typeof input.sentAt === 'number' && Number.isSafeInteger(input.sentAt)
        ? { sentAt: input.sentAt }
        : {}),
    })
    if (result.status === 'rejected') {
      output = { status: 'rejected', reason: result.reason }
    } else {
      const { candidate } = result
      const auto =
        typeof input.currency === 'string' &&
        candidateHolds(candidate, {
          enabled: input.autoAdd === true,
          currency: input.currency,
          accounts: Array.isArray(input.accounts) ? input.accounts : [],
          categories,
        }).length === 0
      const live: LiveSource | null =
        input.source === 'sms' || input.source === 'notification' ? input.source : null
      const at = typeof input.sentAt === 'number' ? input.sentAt : 0
      const slug = autoAddCategory(candidate, categories)?.categorySlug
      const category = categories.find((option) => option.slug === slug)
      output = {
        status: 'candidate',
        candidate: candidateToJSON(candidate),
        requestId: confirmationRequestId(candidate.fingerprint),
        auto,
        notice: auto
          ? addedNoticeFor(candidate, category?.name ?? slug ?? 'a category')
          : noticeFor(candidate),
        capture: live === null ? null : captureOf(candidate, live, at),
        samePaymentAs:
          live === null
            ? null
            : (samePayment(candidate, live, at, Array.isArray(input.recent) ? input.recent : [])
                ?.fingerprint ?? null),
      }
    }
  } catch {
    // No detail: an error message could carry part of the text.
    output = { status: 'error' }
  }
  return JSON.stringify(output)
}
