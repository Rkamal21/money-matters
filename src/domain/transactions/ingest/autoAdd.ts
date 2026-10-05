import { addDays, daysBetween, type LocalDate } from '../../period/LocalDate'
import type { Money } from '../../money/Money'
import {
  AUTO_APPLY_CONFIDENCE,
  type CategoryRule,
  type CategorySuggestion,
  matchRules,
} from '../categorize/CategoryRule'
import {
  type AccountType,
  type CategoryKind,
  categoryKindFor,
  type Transaction,
  type TransactionKind,
} from '../types'

import { findSimilarTransactions } from './review'
import type { CandidateKind, TransactionCandidate } from './TransactionCandidate'

/**
 * When a detected transaction is added without a tap — ADR-0015 as amended on
 * 2026-10-04, SECURITY.md §9 rule 6. Pure: the caller fetches, these decide.
 *
 * A detection is added automatically only when nothing about it needs a
 * person: its type, amount, payee, category, date and account are all certain,
 * and nothing in the ledger makes it look like a repeat or one half of a
 * transfer between the user's own accounts. Anything else waits for review —
 * an uncertain transaction is never written on its own.
 *
 * The same rules run twice: inside Android's sandbox when the message arrives
 * (to word the notification, src/platform/sms/parserBridge.ts), and in the app
 * before it saves (features/transactions/detection/autoAdd.ts), which alone
 * can see the ledger.
 */

/** Why a detection waits for review instead of being added. */
export type HoldReason =
  /** The user turned automatic adding off. */
  | 'off'
  /** The message does not say which way the money went. */
  | 'type_unknown'
  /** In another currency: the charged rupee amount is unknown. */
  | 'foreign_currency'
  | 'no_merchant'
  /** No category rule for the payee, or only a weak one. */
  | 'no_category'
  | 'no_date'
  /** The duplicate key is the weak, undated one (FingerprintBasis). */
  | 'weak_fingerprint'
  /** No single bank or card account it can belong to. */
  | 'account_unclear'
  /** A transaction with the same amount and type within a day is already in the ledger. */
  | 'similar_exists'
  /** The opposite movement of the same amount, on another account, within two days. */
  | 'possible_transfer'
  /** The entry form's own rules refuse it — a date in the future, say. */
  | 'not_valid'

/** The account fields the decision needs; Android knows these without ids. */
export interface AutoAddAccount {
  readonly type: AccountType
  readonly last4: string | null
  readonly isArchived: boolean
}

export interface AutoAddContext {
  /** The user's switch ("Add clear transactions automatically"). */
  readonly enabled: boolean
  /** The ledger's currency (ARCHITECTURE.md A2). */
  readonly currency: string
  readonly accounts: readonly AutoAddAccount[]
  /** The user's categories: a rule's slug must name one of the right kind that is not archived. */
  readonly categories: readonly {
    readonly slug: string
    readonly kind: CategoryKind
    readonly isArchived?: boolean
  }[]
}

/** Accounts an SMS or payment app can speak for. Cash never; a goal wallet never (ADR-0026). */
const MESSAGE_ACCOUNTS: ReadonlySet<AccountType> = new Set(['bank', 'savings', 'credit_card'])

/**
 * The account a detection belongs to, or `null` when it is not certain:
 *   - the one active bank, savings or card account whose last digits the message shows;
 *   - else, when the user has exactly one such account and gave it no digits, that one;
 *   - else, when the message shows no digits, the user's only such account.
 * Digits that match no account — say, a card the user never added — are never
 * guessed onto another one.
 */
export function autoAddAccount<T extends AutoAddAccount>(
  candidate: Pick<TransactionCandidate, 'accountLast4'>,
  accounts: readonly T[],
): T | null {
  const eligible = accounts.filter(
    (account) => !account.isArchived && MESSAGE_ACCOUNTS.has(account.type),
  )
  const last4 = candidate.accountLast4
  if (last4 !== null) {
    const matches = eligible.filter((account) => account.last4?.endsWith(last4) === true)
    if (matches.length === 1) return matches[0] ?? null
    if (matches.length > 1) return null
  }
  const [only, ...rest] = eligible
  if (only === undefined || rest.length > 0) return null
  return last4 === null || only.last4 === null || only.last4 === '' ? only : null
}

/**
 * The candidate with today's rules applied: Android parsed it with the rules it
 * was last handed, and the user may have taught one since. A category it
 * already has is kept.
 */
export function withCurrentRules(
  candidate: TransactionCandidate,
  rules: readonly CategoryRule[],
  categories: AutoAddContext['categories'],
): TransactionCandidate {
  if (candidate.category !== null || candidate.kind === null || candidate.merchantRaw === null) {
    return candidate
  }
  const expected = categoryKindFor(candidate.kind)
  const kinds = new Map(categories.map((category) => [category.slug, category.kind]))
  const category = matchRules(
    rules.filter((rule) => kinds.get(rule.categorySlug) === expected),
    candidate.merchantRaw,
  )
  return category === null ? candidate : { ...candidate, category }
}

/** The category an automatic add would use: a confident rule for a live category of the right kind. */
export function autoAddCategory(
  candidate: Pick<TransactionCandidate, 'kind' | 'category'>,
  categories: AutoAddContext['categories'],
): CategorySuggestion | null {
  const { kind, category } = candidate
  if (kind === null || category === null || category.confidence < AUTO_APPLY_CONFIDENCE) return null
  const expected = categoryKindFor(kind)
  const live = categories.some(
    (option) =>
      option.slug === category.categorySlug &&
      option.kind === expected &&
      option.isArchived !== true,
  )
  return live ? category : null
}

/** What the message alone decides — everything except the ledger checks. Empty: nothing holds it. */
export function candidateHolds(
  candidate: TransactionCandidate,
  context: AutoAddContext,
): HoldReason[] {
  const holds: HoldReason[] = []
  if (!context.enabled) holds.push('off')
  if (candidate.kind === null) holds.push('type_unknown')
  if (candidate.amount.currency !== context.currency) holds.push('foreign_currency')
  if (candidate.merchant === null) holds.push('no_merchant')
  if (autoAddCategory(candidate, context.categories) === null) holds.push('no_category')
  if (candidate.occurredOn === null) holds.push('no_date')
  if (candidate.fingerprint.basis === 'fields_undated') holds.push('weak_fingerprint')
  if (autoAddAccount(candidate, context.accounts) === null) holds.push('account_unclear')
  return holds
}

/** How far apart the two messages of an own-account transfer may be (ROADMAP.md M12). */
export const TRANSFER_WITHIN_DAYS = 2

export interface LedgerProbe {
  readonly amount: Money
  readonly kind: CandidateKind
  readonly occurredOn: LocalDate
  readonly accountId: string
  readonly merchant: string | null
}

/** The ledger window the checks below need around a date. */
export function ledgerWindow(occurredOn: LocalDate): {
  readonly from: LocalDate
  readonly to: LocalDate
} {
  return {
    from: addDays(occurredOn, -TRANSFER_WITHIN_DAYS),
    to: addDays(occurredOn, TRANSFER_WITHIN_DAYS),
  }
}

const OPPOSITE: Readonly<Partial<Record<TransactionKind, TransactionKind>>> = {
  expense: 'income',
  income: 'expense',
}

/**
 * The other half of a transfer between the user's own accounts, if the ledger
 * holds one: the opposite movement of the same amount, on a different account,
 * within two days. Banks give the two halves different references, so the
 * amount and timing are the evidence (ROADMAP.md M12). The closest date wins.
 */
export function transferPartner(
  probe: LedgerProbe,
  existing: readonly Transaction[],
): Transaction | null {
  const opposite = OPPOSITE[probe.kind]
  if (opposite === undefined) return null
  const partners = existing
    .filter(
      (transaction) =>
        transaction.deletedAt === null &&
        transaction.kind === opposite &&
        transaction.accountId !== probe.accountId &&
        transaction.amount.currency === probe.amount.currency &&
        transaction.amount.minor === probe.amount.minor &&
        Math.abs(daysBetween(transaction.occurredOn, probe.occurredOn)) <= TRANSFER_WITHIN_DAYS,
    )
    .sort(
      (a, b) =>
        Math.abs(daysBetween(a.occurredOn, probe.occurredOn)) -
          Math.abs(daysBetween(b.occurredOn, probe.occurredOn)) || a.id.localeCompare(b.id),
    )
  return partners[0] ?? null
}

/** What the ledger decides, given the transactions in `ledgerWindow`. Empty: nothing holds it. */
export function ledgerHolds(probe: LedgerProbe, existing: readonly Transaction[]): HoldReason[] {
  const holds: HoldReason[] = []
  if (findSimilarTransactions(probe, existing).length > 0) holds.push('similar_exists')
  if (transferPartner(probe, existing) !== null) holds.push('possible_transfer')
  return holds
}
