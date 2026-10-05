import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ChevronLeft, Plus, Trash } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { AmountInput, Field, Input, Select } from '@/components/ui/Field'
import { Money } from '@/components/ui/Money'
import { Sheet } from '@/components/ui/Sheet'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { Badge } from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import { useAccounts, useGoals, useInvalidateLedger, usePreferences } from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { AppError } from '@/domain/errors/AppError'
import { negate, toMajorString } from '@/domain/money/Money'
import { amountOwed, openingBalanceFromEntry } from '@/domain/transactions/accounts'
import type { AccountType, AccountWithBalance } from '@/domain/transactions/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { amountField, toMoney, toMoneyOrNull } from '@/lib/forms'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

const TYPE_LABEL: Readonly<Record<AccountType, string>> = {
  bank: 'Bank account',
  cash: 'Cash',
  savings: 'Savings account',
  credit_card: 'Credit card',
  wallet: 'Wallet',
}

export function AccountsSettingsPage() {
  usePageTitle('Accounts')
  const accounts = useAccounts()
  const goals = useGoals()
  const { locale } = usePreferences()
  const [editing, setEditing] = useState<AccountWithBalance | 'new' | null>(null)
  const backing = new Map((goals.data ?? []).map((goal) => [goal.walletAccountId, goal.name]))

  const all = accounts.data ?? []
  const active = all.filter((account) => !account.isArchived)
  const archived = all.filter((account) => account.isArchived)

  const row = (account: AccountWithBalance) => (
    <li key={account.id}>
      <button
        type="button"
        onClick={() => setEditing(account)}
        className="flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-surface-2/60"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-text">
            <span className="truncate">{account.name}</span>
            {backing.has(account.id) && <Badge>Goal: {backing.get(account.id)}</Badge>}
          </span>
          <span className="text-xs text-text-muted">
            {TYPE_LABEL[account.type]}
            {account.last4 ? ` · ••${account.last4}` : ''}
            {account.institution ? ` · ${account.institution}` : ''}
          </span>
        </span>
        {account.type === 'credit_card' ? (
          <span className="text-right text-sm">
            <span className="block text-xs text-text-muted">Owed</span>
            <Money value={amountOwed(account.balance)} locale={locale} className="font-semibold" />
          </span>
        ) : (
          <Money
            value={account.balance}
            locale={locale}
            tone={account.balance.minor < 0n ? 'negative' : 'default'}
            className="text-sm font-semibold"
          />
        )}
      </button>
    </li>
  )

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/settings"
        className="inline-flex items-center gap-1 text-sm font-medium text-text-muted hover:text-text"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Settings
      </Link>
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Accounts</h1>
          <p className="text-sm text-text-muted">
            Balances are worked out from your transactions — never typed in.
          </p>
        </div>
        <Button
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => setEditing('new')}
        >
          Add
        </Button>
      </header>

      {accounts.isPending ? (
        <LoadingBlock label="Loading accounts">
          <Skeleton className="h-48 w-full" />
        </LoadingBlock>
      ) : accounts.isError ? (
        <ErrorState error={toAppError(accounts.error)} onRetry={() => void accounts.refetch()} />
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            title="No accounts yet"
            body="Add where your money sits: a bank account, cash, a card."
            action={<Button onClick={() => setEditing('new')}>Add an account</Button>}
          />
        </Card>
      ) : (
        <>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-border">{active.map(row)}</ul>
          </Card>
          {archived.length > 0 && (
            <details className="rounded-xl border border-border bg-surface">
              <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-medium text-text">
                Archived ({archived.length})
              </summary>
              <ul className="divide-y divide-border border-t border-border">{archived.map(row)}</ul>
            </details>
          )}
        </>
      )}

      {editing !== null && (
        <AccountSheet
          account={editing === 'new' ? null : editing}
          backsGoal={editing !== 'new' && backing.has(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the account a name.')
    .max(60, 'Keep it under 60 characters.'),
  type: z.enum(['bank', 'cash', 'savings', 'credit_card', 'wallet']),
  opening: amountField({ allowZero: true }),
  creditLimit: amountField({ allowZero: true, required: false }),
  institution: z.string().trim().max(60, 'Keep it under 60 characters.'),
  last4: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{4}$/.test(value), 'Enter exactly four digits.'),
})

function AccountSheet({
  account,
  backsGoal,
  onClose,
}: {
  readonly account: AccountWithBalance | null
  readonly backsGoal: boolean
  readonly onClose: () => void
}) {
  const userId = useUserId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const invalidateLedger = useInvalidateLedger()
  const { currency } = usePreferences()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: account?.name ?? '',
      type: account?.type ?? 'bank',
      opening:
        account === null
          ? ''
          : toMajorString(
              account.type === 'credit_card'
                ? negate(account.openingBalance)
                : account.openingBalance,
            ),
      creditLimit: account?.creditLimit ? toMajorString(account.creditLimit) : '',
      institution: account?.institution ?? '',
      last4: account?.last4 ?? '',
    },
  })
  const { errors } = form.formState
  const type = form.watch('type')

  const done = async (message: string) => {
    await Promise.all([
      invalidateLedger(),
      queryClient.invalidateQueries({ queryKey: queryKeys.goals() }),
    ])
    toast.show({ tone: 'success', title: message })
    onClose()
  }

  const save = useMutation({
    mutationFn: (values: z.infer<typeof schema>) => {
      const opening = openingBalanceFromEntry(values.type, toMoney(values.opening, currency))
      const creditLimit =
        values.type === 'credit_card' ? toMoneyOrNull(values.creditLimit, currency) : null
      return account === null
        ? repositories.accounts.create(userId, {
            name: values.name,
            type: values.type,
            currency,
            openingBalance: opening,
            creditLimit,
            institution: values.institution,
            last4: values.last4,
          })
        : repositories.accounts.update(
            account.id,
            {
              name: values.name,
              ...(backsGoal ? {} : { type: values.type }),
              openingBalance: opening,
              creditLimit,
              institution: values.institution,
              last4: values.last4,
            },
            account.updatedAt,
          )
    },
    onSuccess: () => done(account === null ? 'Account added' : 'Account saved'),
    onError: (error) => setServerError(toAppError(error)),
  })

  const archive = useMutation({
    mutationFn: () => {
      if (account === null) throw new Error('no account')
      return repositories.accounts.update(account.id, { isArchived: !account.isArchived })
    },
    onSuccess: () =>
      done(account?.isArchived ? 'Account restored' : 'Account archived — its history is kept'),
    onError: (error) => setServerError(toAppError(error)),
  })

  const remove = useMutation({
    mutationFn: () => {
      if (account === null) throw new Error('no account')
      return repositories.accounts.remove(account.id)
    },
    onSuccess: () => done('Account deleted'),
    onError: (error) => setServerError(toAppError(error)),
  })

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={account === null ? 'Add account' : 'Edit account'}
    >
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
        className="flex flex-col gap-4"
      >
        {serverError && <ErrorState error={serverError} title="That did not work" compact />}
        <Field
          label="Type"
          hint={backsGoal ? 'This wallet backs a goal, so it stays a wallet.' : undefined}
          error={errors.type?.message}
        >
          {(control) => (
            <Select {...control} disabled={backsGoal} {...form.register('type')}>
              {(Object.keys(TYPE_LABEL) as AccountType[]).map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name" error={errors.name?.message}>
          {(control) => <Input {...control} {...form.register('name')} />}
        </Field>
        <Field
          label={
            type === 'credit_card'
              ? 'Owed when you started tracking'
              : 'Balance when you started tracking'
          }
          hint="Every later balance is this plus your transactions."
          error={errors.opening?.message}
        >
          {(control) => <AmountInput {...control} {...form.register('opening')} />}
        </Field>
        {type === 'credit_card' && (
          <Field label="Credit limit" optional error={errors.creditLimit?.message}>
            {(control) => <AmountInput {...control} {...form.register('creditLimit')} />}
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bank or provider" optional error={errors.institution?.message}>
            {(control) => (
              <Input {...control} placeholder="HDFC" {...form.register('institution')} />
            )}
          </Field>
          <Field label="Last 4 digits" optional hint="Display only." error={errors.last4?.message}>
            {(control) => (
              <Input {...control} inputMode="numeric" maxLength={4} {...form.register('last4')} />
            )}
          </Field>
        </div>
        <Button type="submit" size="lg" block loading={save.isPending}>
          {account === null ? 'Add account' : 'Save'}
        </Button>
        {account !== null && (
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
            <Button
              variant="secondary"
              loading={archive.isPending}
              icon={
                account.isArchived ? (
                  <ArchiveRestore aria-hidden="true" className="size-4" />
                ) : (
                  <Archive aria-hidden="true" className="size-4" />
                )
              }
              onClick={() => archive.mutate()}
            >
              {account.isArchived ? 'Restore' : 'Archive'}
            </Button>
            <Button
              variant="ghost"
              className="text-negative"
              loading={remove.isPending}
              icon={<Trash aria-hidden="true" className="size-4" />}
              onClick={() => remove.mutate()}
            >
              Delete
            </Button>
          </div>
        )}
        {account !== null && (
          <p className="text-xs text-text-muted">
            An account with transactions can’t be deleted — that would erase history. Archive it to
            hide it from pickers.
          </p>
        )}
      </form>
    </Sheet>
  )
}
