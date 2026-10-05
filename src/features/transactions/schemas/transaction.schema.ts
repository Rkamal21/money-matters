import { z } from 'zod'

import { addDays, compare, fromISO, tryFromISO, type LocalDate } from '@/domain/period/LocalDate'
import { splitStatus } from '@/domain/transactions/splits'
import { amountField, toMoney } from '@/lib/forms'

/**
 * The entry form's schema — API.md §2.5's validation table, for UX. The
 * database re-checks every rule for truth: amount > 0, transfer shape,
 * category kind, split totals, composite FKs (ARCHITECTURE.md §I.4).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EARLIEST = fromISO('2000-01-01')

export function transactionSchema(currency: string, today: LocalDate) {
  const latest = addDays(today, 366)
  return z
    .object({
      kind: z.enum(['expense', 'income', 'transfer', 'refund']),
      amount: amountField({ currency }),
      description: z.string().max(280, 'Keep it under 280 characters.'),
      accountId: z.string(),
      counterAccountId: z.string(),
      categoryId: z.string(),
      occurredOn: z.string(),
      notes: z.string().max(1000, 'Notes are too long.'),
      isSplit: z.boolean(),
      splits: z.array(z.object({ categoryId: z.string(), amount: z.string() })),
    })
    .superRefine((values, ctx) => {
      if (!UUID.test(values.accountId)) {
        ctx.addIssue({ code: 'custom', path: ['accountId'], message: 'Choose an account.' })
      }

      const date = tryFromISO(values.occurredOn)
      if (date === null) {
        ctx.addIssue({ code: 'custom', path: ['occurredOn'], message: 'Choose a date.' })
      } else if (compare(date, EARLIEST) < 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['occurredOn'],
          message: 'Dates before 2000 are not supported.',
        })
      } else if (compare(date, latest) > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['occurredOn'],
          message: 'Choose a date within the next year.',
        })
      }

      if (values.kind === 'transfer') {
        if (!UUID.test(values.counterAccountId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['counterAccountId'],
            message: 'Choose where the money went.',
          })
        } else if (values.counterAccountId === values.accountId) {
          ctx.addIssue({
            code: 'custom',
            path: ['counterAccountId'],
            message: 'Choose two different accounts.',
          })
        }
        return
      }

      if (!values.isSplit) {
        if (!UUID.test(values.categoryId)) {
          ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose a category.' })
        }
        return
      }

      // Split: ≥ 2 parts, each > 0, distinct categories, summing exactly to the amount.
      if (values.splits.length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['splits'],
          message: 'A split needs at least two parts.',
        })
        return
      }
      const seen = new Set<string>()
      let partsValid = true
      values.splits.forEach((part, index) => {
        if (!UUID.test(part.categoryId)) {
          partsValid = false
          ctx.addIssue({
            code: 'custom',
            path: ['splits', index, 'categoryId'],
            message: 'Choose a category.',
          })
        } else if (seen.has(part.categoryId)) {
          partsValid = false
          ctx.addIssue({
            code: 'custom',
            path: ['splits', index, 'categoryId'],
            message: 'Use each category once.',
          })
        }
        seen.add(part.categoryId)
        const check = amountField({ currency }).safeParse(part.amount)
        if (!check.success) {
          partsValid = false
          ctx.addIssue({
            code: 'custom',
            path: ['splits', index, 'amount'],
            message: check.error.issues[0]?.message ?? 'Enter an amount.',
          })
        }
      })
      const total = amountField({ currency }).safeParse(values.amount)
      if (partsValid && total.success) {
        const status = splitStatus(
          toMoney(values.amount, currency),
          values.splits.map((part) => toMoney(part.amount, currency)),
        )
        if (status !== 'balanced') {
          ctx.addIssue({
            code: 'custom',
            path: ['splits'],
            message:
              status === 'under'
                ? 'The parts add up to less than the total.'
                : 'The parts add up to more than the total.',
          })
        }
      }
    })
}

export type TransactionFormValues = z.infer<ReturnType<typeof transactionSchema>>
