import type { LearnedRule } from '@/data/repositories'
import { toMajorString } from '@/domain/money/Money'
import { fromISO, toISO, type LocalDate } from '@/domain/period/LocalDate'
import {
  AUTO_APPLY_CONFIDENCE,
  type CategoryRule,
  type CategorySuggestion,
  matchRules,
} from '@/domain/transactions/categorize/CategoryRule'
import { normalizeMerchant } from '@/domain/transactions/categorize/normalizeMerchant'
import { confirmationRequestId } from '@/domain/transactions/ingest/review'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'
import {
  type AccountWithBalance,
  type Category,
  categoryKindFor,
  type TransactionKind,
} from '@/domain/transactions/types'
import { toMoney } from '@/lib/forms'

import { transactionSchema, type TransactionFormValues } from '../schemas/transaction.schema'
import type { SaveInput } from '../services/saveTransaction'

/**
 * From a parsed candidate to the entry form's values, and from reviewed values
 * to the very `SaveInput` the entry form sends — so a confirmed candidate is
 * written by `saveTransaction`, validated by `transactionSchema` and suggested
 * a category by the same rules as a transaction typed by hand. There is no
 * second write path.
 */

/** The entry form's values, except that the type may still be undecided. */
export type ReviewDraft = Omit<TransactionFormValues, 'kind'> & {
  readonly kind: TransactionKind | ''
}

export type ReviewField = keyof ReviewDraft

export type DraftCheck =
  | { readonly ok: true; readonly values: TransactionFormValues }
  | { readonly ok: false; readonly errors: Partial<Record<ReviewField, string>> }

export interface DraftContext {
  readonly accounts: readonly AccountWithBalance[]
  readonly categories: readonly Category[]
  readonly today: LocalDate
  /** The user's currency: the ledger records one (ARCHITECTURE.md A2). */
  readonly currency: string
}

/**
 * The reviewed transaction, pre-filled from what the message said:
 *   - the account whose last digits the message shows, else the entry form's default;
 *   - the suggested category, if the user has it with the right kind;
 *   - no type at all when the direction is unknown — a person decides, and an
 *     undecided type can never be saved as an expense by default;
 *   - no amount when the message is in another currency, so a USD figure is
 *     never recorded as rupees.
 */
export function draftFromCandidate(
  candidate: TransactionCandidate,
  context: DraftContext,
): ReviewDraft {
  const active = context.accounts.filter((account) => !account.isArchived)
  const last4 = candidate.accountLast4
  const account =
    (last4 === null ? undefined : active.find((option) => option.last4?.endsWith(last4))) ??
    active.find((option) => option.type !== 'wallet') ??
    active[0]

  const kind = candidate.kind ?? ''
  const categoryKind = kind === '' ? null : categoryKindFor(kind)
  const slug = candidate.category?.categorySlug
  const category = context.categories.find(
    (option) => !option.isArchived && option.kind === categoryKind && option.slug === slug,
  )

  return {
    kind,
    amount: candidate.amount.currency === context.currency ? toMajorString(candidate.amount) : '',
    description: candidate.merchant ?? '',
    accountId: account?.id ?? '',
    counterAccountId: '',
    categoryId: category?.id ?? '',
    occurredOn: toISO(candidate.occurredOn ?? context.today),
    notes: '',
    isSplit: false,
    splits: [],
  }
}

/** The entry form's suggestion rule, verbatim: a match counts only for a category of the right kind. */
export function suggestionFor(input: {
  readonly description: string
  readonly kind: TransactionKind | ''
  readonly rules: readonly CategoryRule[]
  readonly categories: readonly Category[]
}): { readonly match: CategorySuggestion; readonly category: Category } | null {
  if (input.kind === '' || input.kind === 'transfer' || input.description.trim().length < 2) {
    return null
  }
  const categoryKind = categoryKindFor(input.kind)
  const match = matchRules(input.rules, input.description)
  if (match === null) return null
  const category = input.categories.find(
    (option) =>
      !option.isArchived && option.kind === categoryKind && option.slug === match.categorySlug,
  )
  return category === undefined ? null : { match, category }
}

/** The entry form's own schema decides; an undecided type is the one extra rule. */
export function checkDraft(
  draft: ReviewDraft,
  context: Pick<DraftContext, 'currency' | 'today'>,
): DraftCheck {
  if (draft.kind === '') {
    return {
      ok: false,
      errors: { kind: 'Choose the type: the message does not say which way the money went.' },
    }
  }
  const parsed = transactionSchema(context.currency, context.today).safeParse({
    ...draft,
    kind: draft.kind,
  })
  if (parsed.success) return { ok: true, values: parsed.data }
  const errors: Partial<Record<ReviewField, string>> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as ReviewField
    errors[field] ??= issue.message
  }
  return { ok: false, errors }
}

/**
 * The `SaveInput` for a confirmed candidate. The idempotency key comes from the
 * candidate's fingerprint, never from the reviewed values: confirming the same
 * message twice — edited or not — reaches the ledger's existing
 * `client_request_id` guard and writes one row.
 */
export function toSaveInput(
  values: TransactionFormValues,
  context: {
    readonly userId: string
    readonly candidate: TransactionCandidate
    readonly rules: readonly CategoryRule[]
    readonly categories: readonly Category[]
    readonly currency: string
  },
): SaveInput {
  const suggestion = suggestionFor({
    description: values.description,
    kind: values.kind,
    rules: context.rules,
    categories: context.categories,
  })
  return {
    userId: context.userId,
    existing: null,
    kind: values.kind,
    amount: toMoney(values.amount, context.currency),
    accountId: values.accountId,
    counterAccountId: values.kind === 'transfer' ? values.counterAccountId : null,
    categoryId: values.kind === 'transfer' ? null : values.categoryId,
    description: values.description,
    notes: null,
    occurredOn: fromISO(values.occurredOn),
    splits: null,
    clientRequestId: confirmationRequestId(context.candidate.fingerprint),
    suggestion: suggestion?.match ?? null,
    categories: context.categories,
  }
}

/**
 * What confirming a detection teaches (API.md §2.10 "learn"): the payee's
 * category, as a personal rule confident enough that the payee's next message
 * is added without review (domain/transactions/ingest/autoAdd.ts).
 *
 * Only where no confident rule spoke for the payee — none matched, or one
 * below the pre-fill threshold suggested this very category. A *changed*
 * category is already learned by `saveTransaction`, from the suggestion's own
 * pattern. A transfer has no category, so it teaches nothing.
 */
export function ruleFromReview(input: {
  readonly candidate: TransactionCandidate
  readonly values: TransactionFormValues
  readonly rules: readonly CategoryRule[]
  readonly categories: readonly Category[]
}): LearnedRule | null {
  const { candidate, values } = input
  if (values.kind === 'transfer' || values.categoryId === '') return null
  const chosen = input.categories.find((category) => category.id === values.categoryId)
  if (chosen === undefined) return null
  const label = values.description.trim()

  const suggestion =
    suggestionFor({
      description: values.description,
      kind: values.kind,
      rules: input.rules,
      categories: input.categories,
    })?.match ?? candidate.category
  if (suggestion !== null) {
    if (suggestion.categorySlug !== chosen.slug || suggestion.confidence >= AUTO_APPLY_CONFIDENCE) {
      return null
    }
    return {
      pattern: suggestion.pattern,
      matchType: suggestion.matchType,
      merchantLabel: label === '' ? suggestion.merchantLabel : label,
      categorySlug: chosen.slug,
      confidence: 0.95,
      priority: 10,
    }
  }

  const pattern = normalizeMerchant(candidate.merchantRaw ?? values.description)
  if (pattern.length < 2) return null
  return {
    pattern,
    matchType: 'exact',
    merchantLabel: label === '' ? (candidate.merchant ?? pattern) : label,
    categorySlug: chosen.slug,
    confidence: 0.95,
    priority: 10,
  }
}

/**
 * `bank-messages.local` → messages: one per line; blank lines and `#` notes
 * skipped. The text never leaves the page that read it.
 */
export function splitMessages(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}
