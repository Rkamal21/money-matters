import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, CircleCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { AmountInput, Field, Input, Select } from '@/components/ui/Field'
import { Money } from '@/components/ui/Money'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useInvalidateLedger } from '@/data/queries'
import { repositories } from '@/data/repositories'
import { parseAmount } from '@/domain/money/parse'
import { formatDate, toISO, tryFromISO, type LocalDate } from '@/domain/period/LocalDate'
import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import { ledgerWindow, transferPartner } from '@/domain/transactions/ingest/autoAdd'
import {
  confirmationRequestId,
  findSimilarTransactions,
  type SimilarityReason,
} from '@/domain/transactions/ingest/review'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'
import {
  type AccountWithBalance,
  type Category,
  categoryKindFor,
  type Transaction,
  type TransactionKind,
} from '@/domain/transactions/types'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'

import type { TransactionFormValues } from '../schemas/transaction.schema'
import { saveTransaction } from '../services/saveTransaction'

import {
  checkDraft,
  draftFromCandidate,
  type ReviewDraft,
  type ReviewField,
  ruleFromReview,
  suggestionFor,
  toSaveInput,
} from './reviewDraft'

/**
 * Review → confirm → the existing ledger (ROADMAP.md M12, SECURITY.md §9 rule
 * 6). Nothing is written until "Confirm & Add", and then only through
 * `saveTransaction` — the entry form's own write path, invalidating the same
 * ledger queries — so a confirmed candidate is indistinguishable from a
 * transaction typed by hand.
 *
 * Two duplicate checks run before the button is enabled:
 *   exact  this message was already confirmed (its fingerprint-derived
 *          `client_request_id` exists). Confirming is refused; the database
 *          would refuse the second row anyway.
 *   fuzzy  a transaction with the same amount and type within a day exists.
 *          A warning to weigh, not a refusal.
 *
 * And one pairing check (ROADMAP.md M12): the opposite movement of the same
 * amount on another account within two days is probably the other half of a
 * transfer between the user's own accounts. "Record as one transfer" turns
 * that row into the transfer, so the money is not counted as spending and
 * income.
 *
 * Confirming also teaches the payee's category (`ruleFromReview`), so the
 * payee's next message can be added without review.
 */

const KIND_LABEL: Readonly<Record<TransactionKind, string>> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  refund: 'Refund',
}

const REASON_LABEL: Readonly<Record<SimilarityReason, string>> = {
  same_amount: 'same amount',
  same_type: 'same type',
  same_day: 'same day',
  one_day_apart: 'one day apart',
  same_account: 'same account',
  same_merchant: 'same merchant',
}

export interface ReviewCandidateProps {
  readonly candidate: TransactionCandidate
  readonly userId: string
  readonly accounts: readonly AccountWithBalance[]
  readonly categories: readonly Category[]
  readonly rules: readonly CategoryRule[]
  readonly today: LocalDate
  readonly currency: string
  readonly locale: string
  readonly onRejected: () => void
  readonly onAdded: (saved: Transaction) => void
  /**
   * The candidate was recorded as one transfer with an existing row, which
   * `saved` now is; nothing new was added. Without it, the offer is not made.
   */
  readonly onMerged?: (saved: Transaction) => void
  /** The discard button's label: "Ignore" for a detected SMS, "Reject" in the dev tester. */
  readonly rejectLabel?: string
}

export function ReviewCandidate({
  candidate,
  userId,
  accounts,
  categories,
  rules,
  today,
  currency,
  locale,
  onRejected,
  onAdded,
  onMerged,
  rejectLabel = 'Reject',
}: ReviewCandidateProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const invalidateLedger = useInvalidateLedger()
  const [draft, setDraft] = useState<ReviewDraft>(() =>
    draftFromCandidate(candidate, { accounts, categories, today, currency }),
  )
  const [editing, setEditing] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<ReviewField, string>>>({})
  const [added, setAdded] = useState<Transaction | null>(null)
  const requestId = confirmationRequestId(candidate.fingerprint)

  const exact = useQuery({
    queryKey: queryKeys.transactionByRequest(requestId),
    queryFn: () => repositories.transactions.findByClientRequestId(userId, requestId),
  })

  const date = tryFromISO(draft.occurredOn) ?? today
  const { from, to } = ledgerWindow(date)
  const nearby = useQuery({
    queryKey: queryKeys.transactions({
      view: 'detection-nearby',
      from: toISO(from),
      to: toISO(to),
    }),
    queryFn: () => repositories.transactions.list(userId, { from, to }),
  })

  const confirm = useMutation({
    mutationFn: async (values: TransactionFormValues) => {
      const saved = await saveTransaction(
        toSaveInput(values, { userId, candidate, rules, categories, currency }),
        repositories,
      )
      // Best effort, like saveTransaction's own learning: a failed rule must not fail the save.
      const rule = ruleFromReview({ candidate, values, rules, categories })
      if (rule !== null) {
        await repositories.merchantRules.saveUserRule(userId, rule).catch(() => undefined)
      }
      return saved
    },
    onSuccess: async (saved) => {
      // Exactly what the entry form invalidates after a save.
      await Promise.all([
        invalidateLedger(),
        queryClient.invalidateQueries({ queryKey: queryKeys.merchantRules() }),
      ])
      setAdded(saved)
      toast.show({ tone: 'success', title: 'Added to your transactions' })
      onAdded(saved)
    },
  })

  const merge = useMutation({
    mutationFn: (pair: {
      readonly partner: Transaction
      readonly from: string
      readonly to: string
    }) =>
      saveTransaction(
        {
          userId,
          existing: pair.partner,
          kind: 'transfer',
          amount: pair.partner.amount,
          accountId: pair.from,
          counterAccountId: pair.to,
          categoryId: null,
          description: pair.partner.description,
          notes: pair.partner.notes,
          occurredOn: pair.partner.occurredOn,
          splits: null,
          clientRequestId: requestId,
          suggestion: null,
          categories,
        },
        repositories,
      ),
    onSuccess: async (saved) => {
      await invalidateLedger()
      setAdded(saved)
      toast.show({ tone: 'success', title: 'Recorded as one transfer' })
      onMerged?.(saved)
    },
  })

  const amount = parseAmount(draft.amount, currency)
  const duplicate = exact.data ?? null
  const similar =
    amount.ok && draft.kind !== '' && nearby.data !== undefined
      ? findSimilarTransactions(
          {
            amount: amount.value,
            kind: draft.kind,
            occurredOn: date,
            accountId: draft.accountId,
            merchant: draft.description.trim() === '' ? null : draft.description,
          },
          nearby.data.items,
        ).filter((match) => match.transaction.id !== duplicate?.id)
      : []
  const partner =
    onMerged !== undefined &&
    amount.ok &&
    (draft.kind === 'expense' || draft.kind === 'income') &&
    draft.accountId !== '' &&
    nearby.data !== undefined
      ? transferPartner(
          {
            amount: amount.value,
            kind: draft.kind,
            occurredOn: date,
            accountId: draft.accountId,
            merchant: null,
          },
          nearby.data.items,
        )
      : null
  const busy = confirm.isPending || merge.isPending
  const canConfirm = added === null && exact.isSuccess && duplicate === null && !busy

  const set = (field: ReviewField, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }))

  const setKind = (value: string) => {
    const kind = value as TransactionKind | ''
    setDraft((current) => {
      const categoryKind = kind === '' ? null : categoryKindFor(kind)
      const keep =
        categories.find((option) => option.id === current.categoryId)?.kind === categoryKind
      const suggested = keep
        ? null
        : suggestionFor({ description: current.description, kind, rules, categories })
      return {
        ...current,
        kind,
        categoryId: keep ? current.categoryId : (suggested?.category.id ?? ''),
      }
    })
  }

  const submit = () => {
    const check = checkDraft(draft, { currency, today })
    if (!check.ok) {
      setErrors(check.errors)
      setEditing(true)
      return
    }
    setErrors({})
    confirm.mutate(check.values)
  }

  const categoryKind = draft.kind === '' ? null : categoryKindFor(draft.kind)
  const pickable = categories.filter(
    (category) => !category.isArchived && category.kind === categoryKind,
  )
  const activeAccounts = accounts.filter((account) => !account.isArchived)
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? '—'
  const foreign = candidate.amount.currency !== currency

  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-4">
      <h2 id="review-heading" className="text-lg font-semibold text-text">
        Review transaction
      </h2>

      {added !== null ? (
        <div role="status" className="flex gap-3 rounded-xl bg-positive/10 p-4 text-sm text-text">
          <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-positive" />
          <div>
            <p className="font-medium">Added to your ledger</p>
            <p className="text-text-muted">
              <Money value={added.amount} locale={locale} /> · {added.description || '—'} ·{' '}
              {toISO(added.occurredOn)}.{' '}
              <Link to="/transactions" className="font-medium text-brand hover:underline">
                See it in Transactions
              </Link>
            </p>
          </div>
        </div>
      ) : null}

      {added === null && duplicate !== null ? (
        <div role="alert" className="flex gap-3 rounded-xl bg-caution/10 p-4 text-sm text-text">
          <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-caution" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Possible duplicate transaction</p>
            <p>
              This message was already added
              {duplicate.deletedAt === null ? '' : ' (and later deleted)'}:{' '}
              <Money value={duplicate.amount} locale={locale} /> · {duplicate.description || '—'} ·{' '}
              {toISO(duplicate.occurredOn)} · {accountName(duplicate.accountId)}.
            </p>
            <p className="text-text-muted">
              Why: the same{' '}
              {candidate.fingerprint.basis === 'reference'
                ? `bank reference (${candidate.reference ?? '—'})`
                : 'amount, direction, date, payee and account'}{' '}
              gives the same confirmation key, <code className="text-xs">{requestId}</code>, which
              the ledger already holds. Adding it again is refused.
            </p>
          </div>
        </div>
      ) : null}

      {added === null && duplicate === null && similar.length > 0 ? (
        <div role="alert" className="flex gap-3 rounded-xl bg-caution/10 p-4 text-sm text-text">
          <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-caution" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Possible duplicate transaction</p>
            <p>A similar transaction is already in your ledger. Check before adding:</p>
            <ul className="list-disc pl-5">
              {similar.map(({ transaction, reasons }) => (
                <li key={transaction.id}>
                  <Money value={transaction.amount} locale={locale} /> ·{' '}
                  {transaction.description || transaction.merchantLabel || '—'} ·{' '}
                  {toISO(transaction.occurredOn)} — {reasons.map((r) => REASON_LABEL[r]).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {added === null && duplicate === null && partner !== null ? (
        <div role="note" className="flex gap-3 rounded-xl bg-brand/10 p-4 text-sm text-text">
          <ArrowLeftRight aria-hidden="true" className="size-5 shrink-0 text-brand" />
          <div className="flex flex-col items-start gap-2">
            <p className="font-medium">Possible transfer between your accounts</p>
            <p>
              <Money value={partner.amount} locale={locale} />{' '}
              {partner.kind === 'expense' ? 'left' : 'arrived in'} {accountName(partner.accountId)}{' '}
              on {formatDate(partner.occurredOn, locale)}. If this is the same money{' '}
              {draft.kind === 'income' ? 'arriving in' : 'leaving'} {accountName(draft.accountId)},
              record both as one transfer — not as spending and income.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                merge.mutate(
                  draft.kind === 'income'
                    ? { partner, from: partner.accountId, to: draft.accountId }
                    : { partner, from: draft.accountId, to: partner.accountId },
                )
              }
              loading={merge.isPending}
              disabled={busy}
            >
              Record as one transfer
            </Button>
          </div>
        </div>
      ) : null}

      {exact.isError || nearby.isError ? (
        <ErrorState
          error={toAppError(exact.error ?? nearby.error)}
          title="Could not check for duplicates"
          onRetry={() => void Promise.all([exact.refetch(), nearby.refetch()])}
          compact
        />
      ) : null}

      {foreign ? (
        <p role="note" className="text-sm text-caution">
          The message is in {candidate.amount.currency}; your ledger records {currency}. Enter the{' '}
          {currency} amount that was charged.
        </p>
      ) : null}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-text-muted">Amount</dt>
        <dd>{amount.ok ? <Money value={amount.value} locale={locale} /> : 'Not entered'}</dd>
        <dt className="text-text-muted">Merchant</dt>
        <dd>{draft.description.trim() === '' ? '—' : draft.description}</dd>
        <dt className="text-text-muted">Category</dt>
        <dd>
          {draft.kind === 'transfer'
            ? 'None — a transfer has no category'
            : (categories.find((category) => category.id === draft.categoryId)?.name ??
              'Not chosen')}
        </dd>
        <dt className="text-text-muted">Type</dt>
        <dd>{draft.kind === '' ? 'Unknown — choose one' : KIND_LABEL[draft.kind]}</dd>
        <dt className="text-text-muted">Date</dt>
        <dd>{draft.occurredOn}</dd>
        <dt className="text-text-muted">Account</dt>
        <dd>
          {accountName(draft.accountId)}
          {draft.kind === 'transfer' ? ` → ${accountName(draft.counterAccountId)}` : ''}
        </dd>
        <dt className="text-text-muted">Confidence</dt>
        <dd>
          {candidate.confidence.score}/100 ({candidate.confidence.level})
        </dd>
      </dl>

      {editing && added === null ? (
        <fieldset className="flex flex-col gap-3 rounded-xl border border-card-border p-4">
          <legend className="px-1 text-sm font-medium text-text">Edit before adding</legend>
          <Field label="Type" error={errors.kind}>
            {(control) => (
              <Select
                {...control}
                value={draft.kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="">Choose…</option>
                {(Object.keys(KIND_LABEL) as TransactionKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Amount" error={errors.amount}>
            {(control) => (
              <AmountInput
                {...control}
                value={draft.amount}
                onChange={(event) => set('amount', event.target.value)}
              />
            )}
          </Field>
          <Field label="Merchant" error={errors.description}>
            {(control) => (
              <Input
                {...control}
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
              />
            )}
          </Field>
          {draft.kind === 'transfer' ? null : (
            <Field label="Category" error={errors.categoryId}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.categoryId}
                  onChange={(event) => set('categoryId', event.target.value)}
                >
                  <option value="">Choose a category</option>
                  {pickable.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field
            label={draft.kind === 'transfer' ? 'From account' : 'Account'}
            error={errors.accountId}
          >
            {(control) => (
              <Select
                {...control}
                value={draft.accountId}
                onChange={(event) => set('accountId', event.target.value)}
              >
                <option value="">Choose an account</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {draft.kind === 'transfer' ? (
            <Field label="To account" error={errors.counterAccountId}>
              {(control) => (
                <Select
                  {...control}
                  value={draft.counterAccountId}
                  onChange={(event) => set('counterAccountId', event.target.value)}
                >
                  <option value="">Choose an account</option>
                  {activeAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field label="Date" error={errors.occurredOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={draft.occurredOn}
                onChange={(event) => set('occurredOn', event.target.value)}
              />
            )}
          </Field>
        </fieldset>
      ) : null}

      {confirm.isError ? <ErrorState error={toAppError(confirm.error)} compact /> : null}
      {merge.isError ? <ErrorState error={toAppError(merge.error)} compact /> : null}

      {added === null ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={submit} disabled={!canConfirm} loading={confirm.isPending}>
            Confirm &amp; Add
          </Button>
          <Button variant="secondary" onClick={() => setEditing((open) => !open)}>
            {editing ? 'Done editing' : 'Edit'}
          </Button>
          <Button variant="ghost" onClick={onRejected} disabled={busy}>
            {rejectLabel}
          </Button>
          {exact.isPending ? (
            <p role="status" className="self-center text-sm text-text-muted">
              Checking for duplicates…
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
