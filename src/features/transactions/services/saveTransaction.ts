import type { LearnedRule, NewTransaction, Repositories, SplitPart } from '@/data/repositories'
import { equals as moneyEquals, type Money } from '@/domain/money/Money'
import type { LocalDate } from '@/domain/period/LocalDate'
import { type CategorySuggestion, learnedRule } from '@/domain/transactions/categorize/CategoryRule'
import type { Category, Transaction, TransactionKind } from '@/domain/transactions/types'

/**
 * Save a transaction — the orchestration API.md §2.5 describes, unit-testable
 * against fake repositories (ARCHITECTURE.md §G.2).
 *
 *   create   one INSERT, idempotent on clientRequestId; with splits, the
 *            parts are written atomically by `replace_transaction_splits`
 *   edit     optimistic concurrency on `updated_at`
 *   learn    a correction of a suggested category writes a personal rule
 */

export interface SaveInput {
  readonly userId: string
  readonly existing: Transaction | null
  readonly kind: TransactionKind
  readonly amount: Money
  readonly accountId: string
  readonly counterAccountId: string | null
  readonly categoryId: string | null
  readonly description: string
  readonly notes: string | null
  readonly occurredOn: LocalDate
  readonly splits: readonly SplitPart[] | null
  readonly clientRequestId: string
  readonly suggestion: CategorySuggestion | null
  readonly categories: readonly Category[]
}

type Deps = Pick<Repositories, 'transactions' | 'merchantRules'>

function merchantFrom(input: SaveInput): string | null {
  return input.suggestion?.merchantLabel ?? null
}

function isSplitInput(input: SaveInput): boolean {
  return input.kind !== 'transfer' && input.splits !== null && input.splits.length >= 2
}

function directCategoryOf(input: SaveInput): string | null {
  if (input.kind === 'transfer') return null
  return isSplitInput(input) ? (input.splits?.[0]?.categoryId ?? null) : input.categoryId
}

/**
 * Everything a new transaction's writes need, and nothing else — what the
 * offline outbox keeps when the network is down, so a replay writes exactly
 * what the submit would have.
 */
export interface CreateRequest {
  readonly userId: string
  readonly transaction: NewTransaction
  /** Two or more parts, or null for an unsplit transaction. */
  readonly splits: readonly SplitPart[] | null
}

export function createRequestOf(input: SaveInput): CreateRequest {
  return {
    userId: input.userId,
    transaction: {
      kind: input.kind,
      amount: input.amount,
      accountId: input.accountId,
      counterAccountId: input.kind === 'transfer' ? input.counterAccountId : null,
      categoryId: directCategoryOf(input),
      merchantLabel: merchantFrom(input),
      description: input.description,
      notes: input.notes,
      occurredOn: input.occurredOn,
      clientRequestId: input.clientRequestId,
    },
    splits: isSplitInput(input) ? input.splits : null,
  }
}

/**
 * The writes of a create: one INSERT, idempotent on `clientRequestId`, then the
 * parts. Safe to run again — a repeat returns the row already saved, and a row
 * that already has its parts is not split twice.
 */
export async function writeCreate(
  request: CreateRequest,
  deps: Pick<Repositories, 'transactions'>,
): Promise<Transaction> {
  const saved = await deps.transactions.create(request.userId, request.transaction)
  if (request.splits !== null && !saved.isSplit) {
    await deps.transactions.replaceSplits(saved.id, request.splits)
  }
  return saved
}

export async function saveTransaction(input: SaveInput, deps: Deps): Promise<Transaction> {
  const isSplit = isSplitInput(input)
  const directCategory = directCategoryOf(input)

  let saved: Transaction

  if (input.existing === null) {
    saved = await writeCreate(createRequestOf(input), deps)
  } else {
    const existing = input.existing
    const amountChanged = !moneyEquals(existing.amount, input.amount)

    // A split's parts must sum to its amount at every commit, so changing the
    // amount of a split transaction goes: un-split → update → re-split.
    // Becoming a transfer un-splits too: a transfer can have no parts. The
    // fallback is then the old first part's category, which the update
    // immediately clears along with the kind change.
    if (existing.isSplit && (amountChanged || input.kind === 'transfer' || !isSplit)) {
      const fallback =
        (input.kind === 'transfer' ? null : directCategory) ?? existing.splits[0]?.categoryId
      if (fallback !== undefined && fallback !== null) {
        await deps.transactions.replaceSplits(existing.id, [], fallback)
      }
    }

    // `isSplit` already implies the kind is not a transfer.
    const stillSplitOnServer = existing.isSplit && !amountChanged && isSplit
    saved = await deps.transactions.update(
      existing.id,
      {
        kind: input.kind,
        amount: input.amount,
        accountId: input.accountId,
        counterAccountId: input.kind === 'transfer' ? input.counterAccountId : null,
        ...(stillSplitOnServer ? {} : { categoryId: directCategory }),
        description: input.description,
        notes: input.notes,
        occurredOn: input.occurredOn,
        ...(input.suggestion === null ? {} : { merchantLabel: merchantFrom(input) }),
      },
      existing.isSplit && !stillSplitOnServer ? undefined : existing.updatedAt,
    )

    if (isSplit && input.splits !== null) {
      await deps.transactions.replaceSplits(existing.id, input.splits)
    }
  }

  // Learn from a correction: the suggestion said one category, the user chose another.
  if (
    input.suggestion !== null &&
    !isSplit &&
    input.categoryId !== null &&
    input.kind !== 'transfer'
  ) {
    const chosen = input.categories.find((category) => category.id === input.categoryId)
    const rule: LearnedRule | null =
      chosen === undefined
        ? null
        : learnedRule({ suggestion: input.suggestion, correctedSlug: chosen.slug })
    if (rule !== null) {
      // Best effort: a failed rule write must not fail a saved transaction.
      await deps.merchantRules.saveUserRule(input.userId, rule).catch(() => undefined)
    }
  }

  return saved
}
