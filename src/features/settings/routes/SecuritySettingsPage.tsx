import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Download, LogOut, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/Button'
import { CardSection } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { usePreferences, useToday } from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { AppError } from '@/domain/errors/AppError'
import type { Money } from '@/domain/money/Money'
import { toISO } from '@/domain/period/LocalDate'
import type { Transaction } from '@/domain/transactions/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { newPasswordField } from '@/lib/forms'
import { useUserId } from '@/lib/session'

/**
 * Security and data rights — SECURITY.md §3 and §7. Export is the set of
 * SELECTs the user may already run; deletion removes the auth user and every
 * row with it (ON DELETE CASCADE), immediately and irreversibly.
 */

const passwordSchema = z
  .object({ password: newPasswordField, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match.',
  })

function wireMoney(money: Money): { amount_minor: string; currency: string } {
  return { amount_minor: money.minor.toString(), currency: money.currency }
}

export function SecuritySettingsPage() {
  usePageTitle('Security & data')
  const userId = useUserId()
  const today = useToday()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { currency } = usePreferences()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirm: '' },
  })

  const changePassword = useMutation({
    mutationFn: (values: z.infer<typeof passwordSchema>) =>
      repositories.auth.updatePassword(values.password),
    onSuccess: () => {
      setServerError(null)
      form.reset()
      toast.show({ tone: 'success', title: 'Password changed' })
    },
    onError: (error) => setServerError(toAppError(error)),
  })

  const signOutEverywhere = useMutation({
    mutationFn: () => repositories.auth.signOut('global'),
    onSuccess: () => navigate('/login', { replace: true }),
    onError: (error) => toast.show({ tone: 'error', title: toAppError(error).userMessage }),
  })

  const exportData = useMutation({
    mutationFn: async () => {
      const [profile, accounts, categories, goals, periods] = await Promise.all([
        repositories.profiles.get(userId),
        repositories.accounts.list(userId),
        repositories.categories.list(userId),
        repositories.goals.list(userId),
        repositories.budgets.listPeriods(userId, currency, 120),
      ])
      const transactions: Transaction[] = []
      let cursor: string | null = null
      do {
        const page = await repositories.transactions.list(userId, {}, cursor, 500)
        transactions.push(...page.items)
        cursor = page.nextCursor
      } while (cursor !== null)

      return {
        exported_on: today === null ? null : toISO(today),
        format: 'money-matters-export/1',
        profile,
        accounts: accounts.map((account) => ({
          ...account,
          openingBalance: wireMoney(account.openingBalance),
          balance: wireMoney(account.balance),
          creditLimit: account.creditLimit === null ? null : wireMoney(account.creditLimit),
        })),
        categories,
        goals: goals.map((goal) => ({
          ...goal,
          target: wireMoney(goal.target),
          balance: wireMoney(goal.balance),
          targetDate: goal.targetDate === null ? null : toISO(goal.targetDate),
          reachedOn: goal.reachedOn === null ? null : toISO(goal.reachedOn),
        })),
        budget_periods: periods.map((plan) => ({
          start: toISO(plan.period.start),
          end_exclusive: toISO(plan.period.endExclusive),
          expected_income: wireMoney(plan.expectedIncome),
          planned_fixed: wireMoney(plan.plannedFixed),
          planned_savings: wireMoney(plan.plannedSavings),
          closed_at: plan.closedAt,
        })),
        transactions: transactions.map((row) => ({
          ...row,
          amount: wireMoney(row.amount),
          occurredOn: toISO(row.occurredOn),
          splits: row.splits.map((split) => ({ ...split, amount: wireMoney(split.amount) })),
        })),
      }
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `money-matters-export-${data.exported_on ?? 'today'}.json`
      link.click()
      URL.revokeObjectURL(url)
      toast.show({
        tone: 'success',
        title: 'Export ready',
        body: `${data.transactions.length} transactions downloaded.`,
      })
    },
    onError: (error) => toast.show({ tone: 'error', title: toAppError(error).userMessage }),
  })

  const deleteAccount = useMutation({
    mutationFn: () => repositories.auth.deleteAccount(),
    onSuccess: async () => {
      queryClient.clear()
      await navigate('/login', { replace: true })
    },
    onError: (error) => toast.show({ tone: 'error', title: toAppError(error).userMessage }),
  })

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/settings"
        className="inline-flex items-center gap-1 text-sm font-medium text-text-muted hover:text-text"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Settings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-text">Security & data</h1>

      <CardSection title="Change password" titleId="security-password">
        <form
          noValidate
          onSubmit={(event) =>
            void form.handleSubmit((values) => changePassword.mutate(values))(event)
          }
          className="flex flex-col gap-4"
        >
          {serverError && <ErrorState error={serverError} title="Not changed" compact />}
          <Field
            label="New password"
            hint="At least 10 characters."
            error={form.formState.errors.password?.message}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
            )}
          </Field>
          <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="new-password"
                {...form.register('confirm')}
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={changePassword.isPending}>
              Change password
            </Button>
          </div>
        </form>
      </CardSection>

      <CardSection title="Sessions" titleId="security-sessions">
        <p className="mb-3 text-sm text-text-muted">
          Signed in on a shared or lost device? End every session, including this one.
        </p>
        <Button
          variant="secondary"
          loading={signOutEverywhere.isPending}
          icon={<LogOut aria-hidden="true" className="size-4" />}
          onClick={() => signOutEverywhere.mutate()}
        >
          Sign out everywhere
        </Button>
      </CardSection>

      <CardSection title="Your data" titleId="security-data">
        <p className="mb-3 text-sm text-text-muted">
          Download everything you have recorded as JSON — accounts, categories, budgets, goals and
          every transaction. Amounts are exact, in paise.
        </p>
        <Button
          variant="secondary"
          loading={exportData.isPending}
          icon={<Download aria-hidden="true" className="size-4" />}
          onClick={() => exportData.mutate()}
        >
          Download my data
        </Button>
      </CardSection>

      <CardSection title="Delete account" titleId="security-delete" className="border-negative/30">
        <p className="mb-3 text-sm text-text-muted">
          Deletes your account and every record in it, immediately. This can’t be undone — download
          your data first if you want a copy.
        </p>
        <Button variant="danger" onClick={() => setDeleting(true)}>
          Delete my account
        </Button>
      </CardSection>

      <Sheet
        open={deleting}
        onOpenChange={(open) => {
          setDeleting(open)
          if (!open) setConfirmText('')
        }}
        title="Delete your account?"
        description="Everything goes: accounts, transactions, budgets, goals, progress. There is no undo."
      >
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2 rounded-lg bg-negative/8 p-3 text-sm text-negative">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            This permanently removes your data from Money Matters.
          </p>
          <Field label='Type "DELETE" to confirm'>
            {(control) => (
              <Input
                {...control}
                value={confirmText}
                autoComplete="off"
                onChange={(event) => setConfirmText(event.target.value)}
              />
            )}
          </Field>
          <Button
            variant="danger"
            size="lg"
            block
            disabled={confirmText !== 'DELETE'}
            loading={deleteAccount.isPending}
            onClick={() => deleteAccount.mutate()}
          >
            Delete everything
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
