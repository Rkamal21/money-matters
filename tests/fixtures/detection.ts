import { DEFAULT_CATEGORIES } from '@/config/categories.generated'
import { fromMinor } from '@/domain/money/Money'
import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import { parseTransactionMessage } from '@/domain/transactions/ingest/parseTransactionMessage'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'
import type { AccountWithBalance, Category } from '@/domain/transactions/types'

/**
 * Fixtures for the transaction-detection tester's component tests.
 *
 * Messages are anonymised: real bank formats with invented amounts, digits,
 * names and references. Never paste a real message here (SECURITY.md §9).
 */

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const USER_ID = uuid(9)

export const CATEGORIES: Category[] = DEFAULT_CATEGORIES.map((category, index) => ({
  id: uuid(100 + index),
  slug: category.slug,
  name: category.name,
  kind: category.kind,
  treatment: category.treatment,
  icon: category.icon,
  color: category.color,
  isSystem: true,
  isArchived: false,
  position: category.position,
}))

export function categoryId(slug: string): string {
  const found = CATEGORIES.find((category) => category.slug === slug)
  if (found === undefined) throw new Error(`no category ${slug}`)
  return found.id
}

export function account(
  overrides: Partial<AccountWithBalance> & Pick<AccountWithBalance, 'id' | 'name'>,
): AccountWithBalance {
  return {
    type: 'bank',
    currency: 'INR',
    openingBalance: fromMinor(0n, 'INR'),
    creditLimit: null,
    institution: null,
    last4: null,
    isArchived: false,
    position: 0,
    updatedAt: '2026-10-01T00:00:00Z',
    balance: fromMinor(0n, 'INR'),
    ...overrides,
  }
}

export const BANK = account({ id: uuid(2), name: 'SBI', last4: '1234' })
export const SAVINGS = account({ id: uuid(3), name: 'Airtel Payments Bank', type: 'savings' })
export const ACCOUNTS = [BANK, SAVINGS]

function rule(pattern: string, merchantLabel: string, categorySlug: string): CategoryRule {
  return {
    id: `sys:${pattern}`,
    userId: null,
    pattern,
    matchType: 'contains',
    merchantLabel,
    categorySlug,
    confidence: 0.95,
    priority: 100,
    isEnabled: true,
  }
}

export const RULES = [
  rule('swiggy', 'Swiggy', 'food'),
  rule('uber', 'Uber', 'transport'),
  rule('payroll', 'Salary', 'salary'),
]

export const MESSAGES = {
  expense: 'Sent Rs.486.00 From HDFC Bank A/C *1234 To SWIGGY On 03/10/26 Ref 900000000021',
  income: 'Rs 52,000 credited to A/c XX1234 on 01-10-26 by NEFT from ACME PAYROLL',
  unknown: 'UPI transaction of Rs 299 to UBER on 03-10-26. Ref 900000000022',
  sbi: 'Dear UPI user A/C X1234 debited by 250.00 on date 02Oct26 trf to Amit Refno 900000000003 If not u? call-1800111109 for other services-18001234-SBI',
  airtel:
    'Airtel Payments Bank a/c is credited with Rs.250.00. Txn ID: 900000000002. Call 180023400 for help',
  otp: '123456 is your OTP for login. Do not share it with anyone.',
  promo: 'Flat 20% cashback on Swiggy orders above Rs 299',
} as const

export function candidateOf(text: string): TransactionCandidate {
  const result = parseTransactionMessage({ text, rules: RULES, categories: CATEGORIES })
  if (result.status !== 'candidate') throw new Error(`no candidate: ${result.reason}`)
  return result.candidate
}

/** A `transactions` row as PostgREST returns it, with its (empty) splits embedded. */
export function transactionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: uuid(500),
    user_id: USER_ID,
    kind: 'expense',
    amount_minor: 48_600,
    currency_code: 'INR',
    account_id: BANK.id,
    counter_account_id: null,
    category_id: categoryId('food'),
    merchant_label: 'Swiggy',
    description: 'Swiggy',
    notes: null,
    occurred_on: '2026-10-03',
    occurred_at: null,
    source: 'manual',
    status: 'confirmed',
    refund_of_transaction_id: null,
    external_ref: null,
    client_request_id: uuid(600),
    is_split: false,
    metadata: {},
    created_at: '2026-10-03T10:00:00Z',
    updated_at: '2026-10-03T10:00:00Z',
    deleted_at: null,
    transaction_splits: [],
    ...overrides,
  }
}
