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

export async function saveTransaction(input: SaveInput, deps: Deps): Promise<Transaction> {
  const isSplit = input.kind !== 'transfer' && input.splits !== null && input.splits.length >= 2
  const directCategory =
    input.kind === 'transfer'
      ? null
      : isSplit
        ? (input.splits?.[0]?.categoryId ?? null)
        : input.categoryId

  let saved: Transaction

  if (input.existing === null) {
    const create: NewTransaction = {
      kind: input.kind,
      amount: input.amount,
      accountId: input.accountId,
      counterAccountId: input.kind === 'transfer' ? input.counterAccountId : null,
      categoryId: directCategory,
      merchantLabel: merchantFrom(input),
      description: input.description,
      notes: input.notes,
      occurredOn: input.occurredOn,
      clientRequestId: input.clientRequestId,
    }
    saved = await deps.transactions.create(input.userId, create)
    if (isSplit && input.splits !== null && !saved.isSplit) {
      await deps.transactions.replaceSplits(saved.id, input.splits)
    }
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
