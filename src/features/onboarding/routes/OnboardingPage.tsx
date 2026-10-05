import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CategoryIcon } from '@/components/ui/CategoryIcon'
import { AmountInput, Field, Input, Select } from '@/components/ui/Field'
import { BrandMark } from '@/components/ui/Splash'
import { ErrorState } from '@/components/ui/States'
import { ProgressBar } from '@/components/ui/Status'
import { useCategories, useProfile } from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { BudgetPlan } from '@/domain/budget/BudgetPlan'
import type { AppError } from '@/domain/errors/AppError'
import { zero } from '@/domain/money/Money'
import { today as todayIn } from '@/domain/period/Clock'
import { COMMON_TIMEZONES } from '@/domain/profile/Profile'
import { openingBalanceFromEntry } from '@/domain/transactions/accounts'
import type { AccountType } from '@/domain/transactions/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { systemClock } from '@/lib/clock'
import { toAppError } from '@/lib/errors'
import { amountField, toMoney } from '@/lib/forms'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

/**
 * Onboarding — PRODUCT.md §8. Four steps, each writing to a real table; there
 * is no bespoke onboarding storage to migrate away from later.
 *
 *   1. Money basics    → profiles, budget_periods     (required)
 *   2. First account   → accounts                     (required)
 *   3. Savings target  → budget_periods, accounts, goals   (skippable)
 *   4. Fixed costs     → categories, budget_periods   (skippable)
 *
 * Skipped steps leave the app fully usable; the dashboard then shows honest
 * "not set up yet" states with a link to the thing that fills them.
 */

const STEPS = ['Money basics', 'First account', 'Savings', 'Fixed costs'] as const
const CURRENCY = 'INR'

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
  } catch {
    return 'Asia/Kolkata'
  }
}

export function OnboardingPage() {
  usePageTitle('Set up')
  const profile = useProfile()
  const [step, setStep] = useState(0)
  const [plan, setPlan] = useState<BudgetPlan | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)

  if (profile.isPending) return null
  if (profile.isError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorState error={toAppError(profile.error)} onRetry={() => void profile.refetch()} />
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-bg">
      <main id="main" className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-8 sm:py-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="font-semibold text-text">Money Matters</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut aria-hidden="true" className="size-4" />}
            onClick={() => void repositories.auth.signOut('local')}
          >
            Sign out
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>
          <ProgressBar
            ratio={(step + 1) / STEPS.length}
            label={`Step ${step + 1} of ${STEPS.length}`}
          />
        </div>

        {step === 0 && (
          <BasicsStep
            defaultName={profile.data.displayName}
            defaultTimezone={
              profile.data.timezone === 'Asia/Kolkata' ? detectTimezone() : profile.data.timezone
            }
            defaultStartDay={profile.data.budgetPeriodStartDay}
            onDone={(nextPlan) => {
              setPlan(nextPlan)
              setStep(1)
            }}
          />
        )}
        {step === 1 && (
          <AccountStep
            existingId={accountId}
            onBack={() => setStep(0)}
            onDone={(id) => {
              setAccountId(id)
              setStep(2)
            }}
          />
        )}
        {step === 2 && plan !== null && (
          <SavingsStep
            plan={plan}
            onBack={() => setStep(1)}
            onDone={(next) => {
              setPlan(next)
              setStep(3)
            }}
          />
        )}
        {step === 3 && plan !== null && <FixedStep plan={plan} onBack={() => setStep(2)} />}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------

const basicsSchema = z.object({
  displayName: z.string().trim().max(80, 'Keep it under 80 characters.'),
  income: amountField({ currency: CURRENCY }),
  startDay: z.coerce.number().int().min(1).max(28),
  timezone: z.string().min(1),
})

function BasicsStep({
  defaultName,
  defaultTimezone,
  defaultStartDay,
  onDone,
}: {
  readonly defaultName: string
  readonly defaultTimezone: string
  readonly defaultStartDay: number
  readonly onDone: (plan: BudgetPlan) => void
}) {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.input<typeof basicsSchema>, unknown, z.output<typeof basicsSchema>>({
    resolver: zodResolver(basicsSchema),
    defaultValues: {
      displayName: defaultName,
      income: '',
      startDay: defaultStartDay,
      timezone: defaultTimezone,
    },
  })
  const { errors, isSubmitting } = form.formState
  const zones = [...new Set([defaultTimezone, ...COMMON_TIMEZONES])]

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      const updated = await repositories.profiles.update(userId, {
        displayName: values.displayName,
        timezone: values.timezone,
        budgetPeriodStartDay: values.startDay,
        currency: CURRENCY,
      })
      queryClient.setQueryData(queryKeys.profile(), updated)
      const today = todayIn(systemClock, values.timezone)
      const period = await repositories.budgets.ensurePeriod(today, CURRENCY)
      const plan = await repositories.budgets.updatePlan(
        period.id,
        { expectedIncome: toMoney(values.income, CURRENCY) },
        CURRENCY,
      )
      onDone(plan)
    } catch (error) {
      setServerError(toAppError(error))
    }
  })

  return (
    <Card>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">Let’s start with the basics</h1>
          <p className="mt-1 text-sm text-text-muted">
            This is what your safe daily limit is built on. You can change any of it later.
          </p>
        </div>
        {serverError && <ErrorState error={serverError} compact />}
        <Field label="What should we call you?" optional error={errors.displayName?.message}>
          {(control) => (
            <Input {...control} autoComplete="given-name" {...form.register('displayName')} />
          )}
        </Field>
        <Field
          label="Monthly take-home income"
          hint="After tax — what actually lands in your account."
          error={errors.income?.message}
        >
          {(control) => (
            <AmountInput
              {...control}
              scale="xl"
              placeholder="60,000"
              {...form.register('income')}
            />
          )}
        </Field>
        <Field
          label="Your month starts on day"
          hint="Paid on the 25th? Pick 25 and your budget runs 25th to 24th. Days 29–31 are not offered, so every month has the day."
          error={errors.startDay?.message}
        >
          {(control) => (
            <Select {...control} {...form.register('startDay')}>
              {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day === 1 ? '1 (calendar month)' : day}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Timezone"
          hint="Decides when your day ends — so ‘today’ is your today."
          error={errors.timezone?.message}
        >
          {(control) => (
            <Select {...control} {...form.register('timezone')}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Continue
        </Button>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------

const ACCOUNT_TYPES: readonly { readonly value: AccountType; readonly label: string }[] = [
  { value: 'bank', label: 'Bank account' },
  { value: 'cash', label: 'Cash' },
  { value: 'savings', label: 'Savings account' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'wallet', label: 'Wallet (UPI / e-wallet)' },
]

const accountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the account a name.')
    .max(60, 'Keep it under 60 characters.'),
  type: z.enum(['bank', 'cash', 'savings', 'credit_card', 'wallet']),
  balance: amountField({ currency: CURRENCY, allowZero: true }),
})

function AccountStep({
  existingId,
  onBack,
  onDone,
}: {
  readonly existingId: string | null
  readonly onBack: () => void
  readonly onDone: (accountId: string) => void
}) {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof accountSchema>>({
    resolver: zodResolver(accountSchema),
    defaultValues: { name: 'Bank account', type: 'bank', balance: '' },
  })
  const { errors, isSubmitting } = form.formState
  const type = form.watch('type')

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      const opening = openingBalanceFromEntry(values.type, toMoney(values.balance, CURRENCY))
      const account =
        existingId === null
          ? await repositories.accounts.create(userId, {
              name: values.name,
              type: values.type,
              currency: CURRENCY,
              openingBalance: opening,
              position: 1,
            })
          : await repositories.accounts.update(existingId, {
              name: values.name,
              type: values.type,
              openingBalance: opening,
            })
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
      onDone(account.id)
    } catch (error) {
      setServerError(toAppError(error))
    }
  })

  return (
    <Card>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">Where does your money sit?</h1>
          <p className="mt-1 text-sm text-text-muted">
            Start with the account you use most. Add the rest any time.
          </p>
        </div>
        {serverError && <ErrorState error={serverError} compact />}
        <Field label="Account type" error={errors.type?.message}>
          {(control) => (
            <Select {...control} {...form.register('type')}>
              {ACCOUNT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Name" error={errors.name?.message}>
          {(control) => <Input {...control} {...form.register('name')} />}
        </Field>
        <Field
          label={type === 'credit_card' ? 'Amount you owe on it today' : 'Balance today'}
          hint="A rough figure is fine — it is where your ledger starts."
          error={errors.balance?.message}
        >
          {(control) => <AmountInput {...control} placeholder="0" {...form.register('balance')} />}
        </Field>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" size="md" className="flex-1" loading={isSubmitting}>
            Continue
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------

const savingsSchema = z.object({
  savings: amountField({ currency: CURRENCY, allowZero: true, required: false }),
  goalName: z.string().trim().max(60, 'Keep it under 60 characters.'),
  goalTarget: amountField({ currency: CURRENCY, required: false }),
})

function SavingsStep({
  plan,
  onBack,
  onDone,
}: {
  readonly plan: BudgetPlan
  readonly onBack: () => void
  readonly onDone: (plan: BudgetPlan) => void
}) {
  const userId = useUserId()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof savingsSchema>>({
    resolver: zodResolver(savingsSchema),
    defaultValues: { savings: '', goalName: '', goalTarget: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    if (values.goalName !== '' && values.goalTarget.trim() === '') {
      form.setError('goalTarget', { message: 'Give the goal a target amount.' })
      return
    }
    try {
      const savings =
        values.savings.trim() === '' ? zero(CURRENCY) : toMoney(values.savings, CURRENCY)
      const next = await repositories.budgets.updatePlan(
        plan.id,
        { plannedSavings: savings },
        CURRENCY,
      )
      if (values.goalName !== '') {
        // A goal is the purpose of a wallet (ADR-0026): create the wallet, then the goal on it.
        const wallet = await repositories.accounts.create(userId, {
          name: `${values.goalName} fund`.slice(0, 60),
          type: 'wallet',
          currency: CURRENCY,
          openingBalance: zero(CURRENCY),
          position: 50,
        })
        await repositories.goals.create(userId, {
          name: values.goalName,
          target: toMoney(values.goalTarget, CURRENCY),
          walletAccountId: wallet.id,
        })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
          queryClient.invalidateQueries({ queryKey: queryKeys.goals() }),
        ])
      }
      onDone(next)
    } catch (error) {
      setServerError(toAppError(error))
    }
  })

  return (
    <Card>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">Pay yourself first</h1>
          <p className="mt-1 text-sm text-text-muted">
            What you plan to save each month comes off the top, before your daily limit is worked
            out.
          </p>
        </div>
        {serverError && <ErrorState error={serverError} compact />}
        <Field label="Monthly savings target" optional error={errors.savings?.message}>
          {(control) => (
            <AmountInput {...control} placeholder="10,000" {...form.register('savings')} />
          )}
        </Field>
        <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium text-text">A first goal (optional)</legend>
          <p className="-mt-1 text-sm text-text-muted">
            We will create a wallet for it. Money you move into the wallet is the goal’s progress.
          </p>
          <Field label="What are you saving for?" error={errors.goalName?.message}>
            {(control) => (
              <Input {...control} placeholder="Emergency fund" {...form.register('goalName')} />
            )}
          </Field>
          <Field label="Target" error={errors.goalTarget?.message}>
            {(control) => (
              <AmountInput {...control} placeholder="1,00,000" {...form.register('goalTarget')} />
            )}
          </Field>
        </fieldset>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button variant="ghost" onClick={() => onDone(plan)}>
            Skip
          </Button>
          <Button type="submit" className="flex-1" loading={isSubmitting}>
            Continue
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ---------------------------------------------------------------------------

const fixedSchema = z.object({
  fixed: amountField({ currency: CURRENCY, allowZero: true, required: false }),
})

function FixedStep({ plan, onBack }: { readonly plan: BudgetPlan; readonly onBack: () => void }) {
  const userId = useUserId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const categories = useCategories()
  const expense = (categories.data ?? []).filter(
    (category) => category.kind === 'expense' && !category.isArchived,
  )
  const [fixedIds, setFixedIds] = useState<ReadonlySet<string> | null>(null)
  const selected =
    fixedIds ?? new Set(expense.filter((c) => c.treatment === 'fixed').map((c) => c.id))
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof fixedSchema>>({
    resolver: zodResolver(fixedSchema),
    defaultValues: { fixed: '' },
  })
  const { errors, isSubmitting } = form.formState

  const finish = async (save: boolean) => {
    setServerError(null)
    try {
      if (save) {
        const values = form.getValues()
        if (values.fixed.trim() !== '') {
          await repositories.budgets.updatePlan(
            plan.id,
            { plannedFixed: toMoney(values.fixed, CURRENCY) },
            CURRENCY,
          )
        }
        await Promise.all(
          expense
            .filter((category) => (category.treatment === 'fixed') !== selected.has(category.id))
            .map((category) =>
              repositories.categories.update(category.id, {
                treatment: selected.has(category.id) ? 'fixed' : 'variable',
              }),
            ),
        )
      }
      const profile = await repositories.profiles.update(userId, {
        onboardingCompletedAt: new Date().toISOString(),
      })
      queryClient.setQueryData(queryKeys.profile(), profile)
      await queryClient.invalidateQueries()
      await navigate('/dashboard', { replace: true })
    } catch (error) {
      setServerError(toAppError(error))
    }
  }

  const onSubmit = form.handleSubmit(() => finish(true))

  return (
    <Card>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">Your fixed costs</h1>
          <p className="mt-1 text-sm text-text-muted">
            Rent, EMIs and subscriptions are committed money. Marking them fixed keeps them out of
            what you can safely spend day to day.
          </p>
        </div>
        {serverError && <ErrorState error={serverError} compact />}
        <Field label="Roughly how much are they each month?" optional error={errors.fixed?.message}>
          {(control) => (
            <AmountInput {...control} placeholder="25,000" {...form.register('fixed')} />
          )}
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">
            Which categories are fixed?
          </legend>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {expense.map((category) => (
              <li key={category.id}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 has-[:checked]:border-brand has-[:checked]:bg-brand/5">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-brand-strong)]"
                    checked={selected.has(category.id)}
                    onChange={(event) => {
                      const next = new Set(selected)
                      if (event.target.checked) next.add(category.id)
                      else next.delete(category.id)
                      setFixedIds(next)
                    }}
                  />
                  <CategoryIcon icon={category.icon} color={category.color} size="sm" />
                  <span className="text-sm text-text">{category.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button variant="ghost" onClick={() => void finish(false)}>
            Skip
          </Button>
          <Button type="submit" className="flex-1" loading={isSubmitting}>
            Finish
          </Button>
        </div>
      </form>
    </Card>
  )
}
