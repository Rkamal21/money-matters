import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Sparkles, Trash, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'

import { Button, IconButton } from '@/components/ui/Button'
import { CategoryIcon } from '@/components/ui/CategoryIcon'
import { AmountInput, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Money } from '@/components/ui/Money'
import { SegmentedControl, Switch } from '@/components/ui/SegmentedControl'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useInvalidateLedger } from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { AppError } from '@/domain/errors/AppError'
import { abs, isNegative, isZero, toMajorString } from '@/domain/money/Money'
import { parseAmount } from '@/domain/money/parse'
import { addDays, fromISO, toISO, type LocalDate } from '@/domain/period/LocalDate'
import {
  AUTO_APPLY_CONFIDENCE,
  type CategoryRule,
  matchRules,
} from '@/domain/transactions/categorize/CategoryRule'
import { evenSplit, splitRemainder } from '@/domain/transactions/splits'
import {
  type AccountWithBalance,
  type Category,
  categoryKindFor,
  type Transaction,
  type TransactionKind,
} from '@/domain/transactions/types'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { newRequestId, toMoney } from '@/lib/forms'
import { queryKeys } from '@/lib/queryKeys'

import { transactionSchema, type TransactionFormValues } from '../schemas/transaction.schema'
import { saveTransaction } from '../services/saveTransaction'

/**
 * The product's highest-traffic surface (ROADMAP.md M2): an expense in under
 * ten seconds, one-handed. Amount first and focused, the number pad up,
 * category suggested from what you type, today's date by default.
 */

const KIND_OPTIONS: readonly { readonly value: TransactionKind; readonly label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'refund', label: 'Refund' },
]

const SAVE_LABEL: Readonly<Record<TransactionKind, string>> = {
  expense: 'Save expense',
  income: 'Save income',
  transfer: 'Save transfer',
  refund: 'Save refund',
}

const LAST_ACCOUNT_KEY = 'mm.lastAccount'

function rememberedAccount(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_KEY)
  } catch {
    return null
  }
}

function rememberAccount(id: string): void {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY, id)
  } catch {
    // Not remembering is fine.
  }
}

function defaults(
  existing: Transaction | null,
  accounts: readonly AccountWithBalance[],
  today: LocalDate,
): TransactionFormValues {
  if (existing !== null) {
    return {
      kind: existing.kind,
      amount: toMajorString(existing.amount),
      description: existing.description,
      accountId: existing.accountId,
      counterAccountId: existing.counterAccountId ?? '',
      categoryId: existing.categoryId ?? '',
      occurredOn: toISO(existing.occurredOn),
      notes: existing.notes ?? '',
      isSplit: existing.isSplit,
      splits:
        existing.splits.length > 0
          ? existing.splits.map((split) => ({
              categoryId: split.categoryId,
              amount: toMajorString(split.amount),
            }))
          : [
              { categoryId: '', amount: '' },
              { categoryId: '', amount: '' },
            ],
    }
  }
  const active = accounts.filter((account) => !account.isArchived)
  const remembered = rememberedAccount()
  const preferred =
    active.find((account) => account.id === remembered) ??
    active.find((account) => account.type !== 'wallet') ??
    active[0]
  return {
    kind: 'expense',
    amount: '',
    description: '',
    accountId: preferred?.id ?? '',
    counterAccountId: '',
    categoryId: '',
    occurredOn: toISO(today),
    notes: '',
    isSplit: false,
    splits: [
      { categoryId: '', amount: '' },
      { categoryId: '', amount: '' },
    ],
  }
}

export function TransactionForm({
  userId,
  existing,
  accounts,
  categories,
  rules,
  today,
  currency,
  locale,
  onDone,
}: {
  readonly userId: string
  readonly existing: Transaction | null
  readonly accounts: readonly AccountWithBalance[]
  readonly categories: readonly Category[]
  readonly rules: readonly CategoryRule[]
  readonly today: LocalDate
  readonly currency: string
  readonly locale: string
  readonly onDone: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const invalidateLedger = useInvalidateLedger()
  const schema = useMemo(() => transactionSchema(currency, today), [currency, today])
  const form = useForm<TransactionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(existing, accounts, today),
  })
  const splits = useFieldArray({ control: form.control, name: 'splits' })
  const { errors } = form.formState

  // One idempotency key per submission, reused on every retry (DATABASE.md §12).
  const [requestId, setRequestId] = useState(newRequestId)
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [categoryTouched, setCategoryTouched] = useState(existing !== null)
  const [addAnother, setAddAnother] = useState(false)

  const kind = form.watch('kind')
  const description = form.watch('description')
  const categoryId = form.watch('categoryId')
  const isSplit = form.watch('isSplit')
  const amountText = form.watch('amount')
  const splitValues = form.watch('splits')
  const accountId = form.watch('accountId')

  const categoryKind = categoryKindFor(kind)
  const pickable = categories.filter(
    (category) =>
      category.kind === categoryKind && (!category.isArchived || category.id === categoryId),
  )
  const activeAccounts = accounts.filter(
    (account) =>
      !account.isArchived ||
      account.id === existing?.accountId ||
      account.id === existing?.counterAccountId,
  )

  // Suggest → confirm → learn (API.md §2.10). A suggestion is only offered
  // when the user has a category of the right kind with that slug.
  const suggestion = useMemo(() => {
    if (kind === 'transfer' || description.trim().length < 2) return null
    const match = matchRules(rules, description)
    if (match === null) return null
    const category = pickable.find((candidate) => candidate.slug === match.categorySlug)
    return category === undefined ? null : { match, category }
  }, [kind, description, rules, pickable])

  useEffect(() => {
    if (
      suggestion !== null &&
      !categoryTouched &&
      suggestion.match.confidence >= AUTO_APPLY_CONFIDENCE
    ) {
      form.setValue('categoryId', suggestion.category.id, { shouldValidate: false })
    }
  }, [suggestion, categoryTouched, form])

  // Changing the kind to one with a different category kind clears the choice.
  useEffect(() => {
    const current = categories.find((category) => category.id === form.getValues('categoryId'))
    if (current !== undefined && current.kind !== categoryKind) form.setValue('categoryId', '')
  }, [categoryKind, categories, form])

  const parsedTotal = parseAmount(amountText, currency)
  const parsedParts = splitValues.map((part) => parseAmount(part.amount, currency))
  const remainder =
    parsedTotal.ok && parsedParts.every((part) => part.ok)
      ? splitRemainder(
          parsedTotal.value,
          parsedParts.flatMap((part) => (part.ok ? [part.value] : [])),
        )
      : null

  const save = useMutation({
    mutationFn: (values: TransactionFormValues) =>
      saveTransaction(
        {
          userId,
          existing,
          kind: values.kind,
          amount: toMoney(values.amount, currency),
          accountId: values.accountId,
          counterAccountId: values.kind === 'transfer' ? values.counterAccountId : null,
          categoryId: values.kind === 'transfer' || values.isSplit ? null : values.categoryId,
          description: values.description,
          notes: values.notes.trim() === '' ? null : values.notes,
          occurredOn: fromISO(values.occurredOn),
          splits:
            values.kind !== 'transfer' && values.isSplit
              ? values.splits.map((part) => ({
                  categoryId: part.categoryId,
                  amount: toMoney(part.amount, currency),
                }))
              : null,
          clientRequestId: requestId,
          suggestion: suggestion?.match ?? null,
          categories,
        },
        repositories,
      ),
    onSuccess: async (_saved, values) => {
      setServerError(null)
      rememberAccount(values.accountId)
      await Promise.all([
        invalidateLedger(),
        queryClient.invalidateQueries({ queryKey: queryKeys.merchantRules() }),
      ])
      toast.show({ tone: 'success', title: existing === null ? 'Saved' : 'Changes saved' })
      if (addAnother && existing === null) {
        setRequestId(newRequestId())
        setCategoryTouched(false)
        form.reset({
          ...defaults(null, accounts, today),
          kind: values.kind,
          accountId: values.accountId,
          occurredOn: values.occurredOn,
        })
        form.setFocus('amount')
      } else {
        onDone()
      }
    },
    onError: (error) => {
      const appError = toAppError(error)
      setServerError(appError)
      for (const [field, messages] of Object.entries(appError.fieldErrors ?? {})) {
        const name = field === 'splits' ? 'splits' : field
        if (name in form.getValues()) {
          form.setError(name as keyof TransactionFormValues, {
            message: messages[0] ?? appError.userMessage,
          })
        }
      }
    },
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (existing === null) return
      await repositories.transactions.softDelete(existing.id)
    },
    onSuccess: async () => {
      await invalidateLedger()
      toast.show({
        tone: 'info',
        title: 'Transaction deleted',
        action:
          existing === null
            ? undefined
            : {
                label: 'Undo',
                onAction: () => {
                  void repositories.transactions.restore(existing.id).then(() => invalidateLedger())
                },
              },
      } as Parameters<typeof toast.show>[0])
      onDone()
    },
    onError: (error) => setServerError(toAppError(error)),
  })

  const onSubmit = form.handleSubmit((values) => save.mutate(values))

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
      {serverError && <ErrorState error={serverError} title="Not saved" compact />}

      <SegmentedControl
        legend="Type"
        value={kind}
        options={KIND_OPTIONS}
        onChange={(next) => form.setValue('kind', next, { shouldDirty: true })}
      />

      <Field label="Amount" error={errors.amount?.message}>
        {(control) => (
          <AmountInput
            {...control}
            scale="xl"
            placeholder="0"
            data-autofocus={existing === null || undefined}
            enterKeyHint="next"
            {...form.register('amount')}
          />
        )}
      </Field>

      {kind === 'transfer' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="From" error={errors.accountId?.message}>
            {(control) => (
              <Select {...control} {...form.register('accountId')}>
                <option value="">Choose an account</option>
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="To" error={errors.counterAccountId?.message}>
            {(control) => (
              <Select {...control} {...form.register('counterAccountId')}>
                <option value="">Choose an account</option>
                {activeAccounts
                  .filter((account) => account.id !== accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.type === 'wallet' ? ' (wallet)' : ''}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <p className="text-xs text-text-muted sm:col-span-2">
            Moving money between your own accounts is neither income nor spending.
          </p>
        </div>
      ) : (
        <Field
          label={kind === 'income' ? 'Into' : kind === 'refund' ? 'Refunded to' : 'Paid from'}
          error={errors.accountId?.message}
        >
          {(control) => (
            <Select {...control} {...form.register('accountId')}>
              <option value="">Choose an account</option>
              {activeAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <Field
        label={kind === 'transfer' ? 'Note' : 'What was it?'}
        optional
        error={errors.description?.message}
      >
        {(control) => (
          <Input
            {...control}
            placeholder={
              kind === 'income'
                ? 'Salary, freelance…'
                : kind === 'transfer'
                  ? 'Savings top-up'
                  : 'Swiggy, rent, groceries…'
            }
            autoComplete="off"
            {...form.register('description')}
          />
        )}
      </Field>

      {suggestion !== null && !isSplit && (
        <div className="-mt-3 flex items-center justify-between gap-2 rounded-lg bg-brand/8 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-text">
            <Sparkles aria-hidden="true" className="size-4 shrink-0 text-brand" />
            <span>
              {suggestion.match.merchantLabel} →{' '}
              <span className="font-medium">{suggestion.category.name}</span>
              <span className="text-text-muted">
                {' '}
                · {Math.round(suggestion.match.confidence * 100)}% match
              </span>
            </span>
          </span>
          {categoryId !== suggestion.category.id && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCategoryTouched(true)
                form.setValue('categoryId', suggestion.category.id, { shouldValidate: true })
              }}
            >
              Use
            </Button>
          )}
        </div>
      )}

      {kind !== 'transfer' && !isSplit && (
        <fieldset aria-describedby={errors.categoryId ? 'category-error' : undefined}>
          <legend className="mb-2 text-sm font-medium text-text">Category</legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {pickable.map((category) => (
              <label
                key={category.id}
                className={cn(
                  'flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center text-xs font-medium transition-colors duration-150',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  categoryId === category.id
                    ? 'border-brand bg-brand/8 text-text'
                    : 'border-border text-text-muted hover:bg-surface-2',
                )}
              >
                <input
                  type="radio"
                  value={category.id}
                  className="sr-only"
                  {...form.register('categoryId', { onChange: () => setCategoryTouched(true) })}
                />
                <CategoryIcon icon={category.icon} color={category.color} size="sm" />
                <span className="line-clamp-2 leading-tight">{category.name}</span>
              </label>
            ))}
          </div>
          {errors.categoryId && (
            <p
              id="category-error"
              role="alert"
              className="mt-1.5 text-xs font-medium text-negative"
            >
              {errors.categoryId.message}
            </p>
          )}
        </fieldset>
      )}

      <Field label="Date" error={errors.occurredOn?.message}>
        {(control) => (
          <div className="flex flex-wrap items-center gap-2">
            <Input {...control} type="date" className="max-w-48" {...form.register('occurredOn')} />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => form.setValue('occurredOn', toISO(today), { shouldValidate: true })}
            >
              Today
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                form.setValue('occurredOn', toISO(addDays(today, -1)), { shouldValidate: true })
              }
            >
              Yesterday
            </Button>
          </div>
        )}
      </Field>

      <details
        className="rounded-lg border border-border"
        open={isSplit || (existing?.notes ?? '') !== ''}
      >
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-text">
          More options
        </summary>
        <div className="flex flex-col gap-4 border-t border-border p-3">
          {kind !== 'transfer' && (
            <Switch
              checked={isSplit}
              onChange={(checked) => form.setValue('isSplit', checked, { shouldValidate: false })}
              label="Split across categories"
              description="One payment, several categories — a supermarket bill that is part groceries, part household."
            />
          )}

          {kind !== 'transfer' && isSplit && (
            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">Split parts</legend>
              {splits.fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <Field
                    className="flex-1"
                    label={`Part ${index + 1} category`}
                    error={errors.splits?.[index]?.categoryId?.message}
                  >
                    {(control) => (
                      <Select {...control} {...form.register(`splits.${index}.categoryId`)}>
                        <option value="">Choose</option>
                        {pickable.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field
                    className="w-32"
                    label="Amount"
                    error={errors.splits?.[index]?.amount?.message}
                  >
                    {(control) => (
                      <AmountInput
                        {...control}
                        placeholder="0"
                        {...form.register(`splits.${index}.amount`)}
                      />
                    )}
                  </Field>
                  <IconButton
                    label={`Remove part ${index + 1}`}
                    className="mt-6"
                    disabled={splits.fields.length <= 2}
                    onClick={() => splits.remove(index)}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </IconButton>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus aria-hidden="true" className="size-4" />}
                    onClick={() => splits.append({ categoryId: '', amount: '' })}
                  >
                    Add part
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!parsedTotal.ok}
                    onClick={() => {
                      if (!parsedTotal.ok) return
                      evenSplit(parsedTotal.value, splits.fields.length).forEach((part, index) =>
                        form.setValue(`splits.${index}.amount`, toMajorString(part)),
                      )
                    }}
                  >
                    Split evenly
                  </Button>
                </div>
                {remainder !== null && (
                  <p
                    aria-live="polite"
                    className={cn(
                      'text-sm font-medium',
                      isZero(remainder) ? 'text-positive' : 'text-caution',
                    )}
                  >
                    {isZero(remainder) ? (
                      'Balanced'
                    ) : isNegative(remainder) ? (
                      <>
                        <Money value={abs(remainder)} locale={locale} /> over
                      </>
                    ) : (
                      <>
                        <Money value={remainder} locale={locale} /> left to assign
                      </>
                    )}
                  </p>
                )}
              </div>
              {errors.splits?.message && (
                <p role="alert" className="text-xs font-medium text-negative">
                  {errors.splits.message}
                </p>
              )}
              {errors.splits?.root?.message && (
                <p role="alert" className="text-xs font-medium text-negative">
                  {errors.splits.root.message}
                </p>
              )}
            </fieldset>
          )}

          <Field label="Notes" optional error={errors.notes?.message}>
            {(control) => <Textarea {...control} rows={2} {...form.register('notes')} />}
          </Field>
        </div>
      </details>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-surface px-4 pt-3 sm:-mx-5 sm:px-5">
        <Button type="submit" size="lg" block loading={save.isPending}>
          {SAVE_LABEL[kind]}
        </Button>
        {existing === null ? (
          <label className="flex min-h-10 cursor-pointer items-center justify-center gap-2 text-sm text-text-muted">
            <input
              type="checkbox"
              checked={addAnother}
              onChange={(event) => setAddAnother(event.target.checked)}
              className="size-4"
            />
            Keep this open to add another
          </label>
        ) : (
          <Button
            variant="ghost"
            className="text-negative"
            icon={<Trash aria-hidden="true" className="size-4" />}
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete transaction
          </Button>
        )}
      </div>
    </form>
  )
}
