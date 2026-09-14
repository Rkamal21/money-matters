import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/Button'
import { AmountInput, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useInvalidateLedger } from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { AppError } from '@/domain/errors/AppError'
import type { GoalWithProgress } from '@/domain/goals/Goal'
import { toMajorString, zero } from '@/domain/money/Money'
import { fromISO, toISO, tryFromISO, type LocalDate } from '@/domain/period/LocalDate'
import type { AccountWithBalance } from '@/domain/transactions/types'
import { toAppError } from '@/lib/errors'
import { amountField, newRequestId, toMoney } from '@/lib/forms'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

/**
 * Goal sheets. A goal is the purpose of one wallet (ADR-0026):
 *
 *   create   a new wallet (or an unused existing one), then the goal on it
 *   add      a transfer INTO the wallet — never income, never spending
 *   withdraw a transfer OUT of the wallet
 *
 * There is no "set saved amount". Progress moves only when money moves.
 */

const goalSchema = z.object({
  name: z.string().trim().min(1, 'Name the goal.').max(60, 'Keep it under 60 characters.'),
  target: amountField(),
  targetDate: z
    .string()
    .refine((value) => value === '' || tryFromISO(value) !== null, 'Choose a valid date.'),
  walletMode: z.enum(['new', 'existing']),
  walletAccountId: z.string(),
})

export function CreateGoalSheet({
  open,
  onClose,
  wallets,
  currency,
  today,
}: {
  readonly open: boolean
  readonly onClose: () => void
  /** Wallets that do not yet back a goal. */
  readonly wallets: readonly AccountWithBalance[]
  readonly currency: string
  readonly today: LocalDate
}) {
  const userId = useUserId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState<AppError | null>(null)
  // If the goal write fails after the wallet was created, retry against the
  // same wallet rather than creating a second, empty one (API.md §2.7).
  const [createdWalletId, setCreatedWalletId] = useState<string | null>(null)
  const form = useForm<z.infer<typeof goalSchema>>({
    resolver: zodResolver(goalSchema),
    defaultValues: { name: '', target: '', targetDate: '', walletMode: 'new', walletAccountId: '' },
  })
  const { errors, isSubmitting } = form.formState
  const walletMode = form.watch('walletMode')

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    if (values.walletMode === 'existing' && values.walletAccountId === '') {
      form.setError('walletAccountId', { message: 'Choose a wallet.' })
      return
    }
    if (values.targetDate !== '' && (tryFromISO(values.targetDate)?.y ?? 0) < today.y) {
      form.setError('targetDate', { message: 'Choose a date that has not passed.' })
      return
    }
    try {
      let walletId = values.walletMode === 'existing' ? values.walletAccountId : createdWalletId
      if (walletId === null) {
        const wallet = await repositories.accounts.create(userId, {
          name: `${values.name} fund`.slice(0, 60),
          type: 'wallet',
          currency,
          openingBalance: zero(currency),
          position: 50,
        })
        walletId = wallet.id
        setCreatedWalletId(wallet.id)
      }
      await repositories.goals.create(userId, {
        name: values.name,
        target: toMoney(values.target, currency),
        walletAccountId: walletId,
        targetDate: values.targetDate === '' ? null : fromISO(values.targetDate),
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.goals() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.gamification() }),
      ])
      toast.show({
        tone: 'success',
        title: 'Goal created',
        body: 'Move money into its wallet to make progress.',
      })
      form.reset()
      setCreatedWalletId(null)
      onClose()
    } catch (error) {
      setServerError(toAppError(error))
    }
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="New goal"
      description="A goal is a wallet with a purpose. What you move into the wallet is your progress."
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        {serverError && <ErrorState error={serverError} title="Not created" compact />}
        <Field label="What are you saving for?" error={errors.name?.message}>
          {(control) => (
            <Input
              {...control}
              placeholder="New laptop"
              data-autofocus
              {...form.register('name')}
            />
          )}
        </Field>
        <Field label="Target" error={errors.target?.message}>
          {(control) => (
            <AmountInput {...control} placeholder="80,000" {...form.register('target')} />
          )}
        </Field>
        <Field
          label="By when?"
          optional
          hint="With a date we can tell you what to set aside each month."
          error={errors.targetDate?.message}
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              min={toISO(today)}
              className="max-w-52"
              {...form.register('targetDate')}
            />
          )}
        </Field>
        <SegmentedControl
          legend="Wallet"
          hideLegend={false}
          value={walletMode}
          options={[
            { value: 'new', label: 'Create a wallet' },
            { value: 'existing', label: 'Use a wallet' },
          ]}
          onChange={(value) => form.setValue('walletMode', value)}
        />
        {walletMode === 'existing' &&
          (wallets.length === 0 ? (
            <p className="text-sm text-text-muted">
              You have no free wallets — each wallet backs at most one goal. Create a new one
              instead.
            </p>
          ) : (
            <Field label="Wallet" error={errors.walletAccountId?.message}>
              {(control) => (
                <Select {...control} {...form.register('walletAccountId')}>
                  <option value="">Choose a wallet</option>
                  {wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Create goal
        </Button>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

const moveSchema = z.object({
  amount: amountField(),
  otherAccountId: z.string().min(1, 'Choose an account.'),
  occurredOn: z.string().refine((value) => tryFromISO(value) !== null, 'Choose a date.'),
  note: z.string().max(280),
})

export function MoveMoneySheet({
  goal,
  direction,
  accounts,
  currency,
  today,
  onClose,
}: {
  readonly goal: GoalWithProgress
  readonly direction: 'in' | 'out'
  readonly accounts: readonly AccountWithBalance[]
  readonly currency: string
  readonly today: LocalDate
  readonly onClose: () => void
}) {
  const userId = useUserId()
  const toast = useToast()
  const invalidateLedger = useInvalidateLedger()
  const [requestId] = useState(newRequestId)
  const [serverError, setServerError] = useState<AppError | null>(null)
  const others = accounts.filter(
    (account) => account.id !== goal.walletAccountId && !account.isArchived,
  )
  const form = useForm<z.infer<typeof moveSchema>>({
    resolver: zodResolver(moveSchema),
    defaultValues: {
      amount: '',
      otherAccountId: others.find((account) => account.type !== 'wallet')?.id ?? '',
      occurredOn: toISO(today),
      note: '',
    },
  })
  const { errors } = form.formState

  const move = useMutation({
    mutationFn: (values: z.infer<typeof moveSchema>) =>
      // A contribution IS a transfer (ARCHITECTURE.md §G.2): one INSERT, idempotent on the request id.
      repositories.transactions.create(userId, {
        kind: 'transfer',
        amount: toMoney(values.amount, currency),
        accountId: direction === 'in' ? values.otherAccountId : goal.walletAccountId,
        counterAccountId: direction === 'in' ? goal.walletAccountId : values.otherAccountId,
        description:
          values.note.trim() || (direction === 'in' ? `Towards ${goal.name}` : `From ${goal.name}`),
        occurredOn: fromISO(values.occurredOn),
        clientRequestId: requestId,
      }),
    onSuccess: async () => {
      await invalidateLedger()
      toast.show({
        tone: 'success',
        title: direction === 'in' ? `Added to ${goal.name}` : `Withdrawn from ${goal.name}`,
        body: 'A transfer between your accounts — not income, not spending.',
      })
      onClose()
    },
    onError: (error) => setServerError(toAppError(error)),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={direction === 'in' ? `Add money to ${goal.name}` : `Withdraw from ${goal.name}`}
    >
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => move.mutate(values))(event)}
        className="flex flex-col gap-4"
      >
        {serverError && <ErrorState error={serverError} title="Not saved" compact />}
        <Field label="Amount" error={errors.amount?.message}>
          {(control) => (
            <AmountInput {...control} scale="xl" data-autofocus {...form.register('amount')} />
          )}
        </Field>
        <Field label={direction === 'in' ? 'From' : 'To'} error={errors.otherAccountId?.message}>
          {(control) => (
            <Select {...control} {...form.register('otherAccountId')}>
              <option value="">Choose an account</option>
              {others.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Date" error={errors.occurredOn?.message}>
          {(control) => (
            <Input {...control} type="date" className="max-w-52" {...form.register('occurredOn')} />
          )}
        </Field>
        <Field label="Note" optional error={errors.note?.message}>
          {(control) => <Textarea {...control} rows={2} {...form.register('note')} />}
        </Field>
        <Button type="submit" size="lg" block loading={move.isPending}>
          {direction === 'in' ? 'Add money' : 'Withdraw'}
        </Button>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

const editSchema = z.object({
  name: z.string().trim().min(1, 'Name the goal.').max(60, 'Keep it under 60 characters.'),
  target: amountField(),
  targetDate: z
    .string()
    .refine((value) => value === '' || tryFromISO(value) !== null, 'Choose a valid date.'),
})

export function EditGoalSheet({
  goal,
  currency,
  onClose,
}: {
  readonly goal: GoalWithProgress
  readonly currency: string
  readonly onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: goal.name,
      target: toMajorString(goal.target),
      targetDate: goal.targetDate === null ? '' : toISO(goal.targetDate),
    },
  })
  const { errors } = form.formState

  const save = useMutation({
    mutationFn: (values: z.infer<typeof editSchema>) =>
      repositories.goals.update(
        goal.id,
        {
          name: values.name,
          target: toMoney(values.target, currency),
          targetDate: values.targetDate === '' ? null : fromISO(values.targetDate),
        },
        goal.updatedAt,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.goals() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() }),
      ])
      toast.show({ tone: 'success', title: 'Goal updated' })
      onClose()
    },
    onError: (error) => setServerError(toAppError(error)),
  })

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Edit goal"
      description="The wallet behind a goal is fixed when it is created."
    >
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
        className="flex flex-col gap-4"
      >
        {serverError && <ErrorState error={serverError} title="Not saved" compact />}
        <Field label="Name" error={errors.name?.message}>
          {(control) => <Input {...control} {...form.register('name')} />}
        </Field>
        <Field label="Target" error={errors.target?.message}>
          {(control) => <AmountInput {...control} {...form.register('target')} />}
        </Field>
        <Field label="Target date" optional error={errors.targetDate?.message}>
          {(control) => (
            <Input {...control} type="date" className="max-w-52" {...form.register('targetDate')} />
          )}
        </Field>
        <Button type="submit" size="lg" block loading={save.isPending}>
          Save
        </Button>
      </form>
    </Sheet>
  )
}
