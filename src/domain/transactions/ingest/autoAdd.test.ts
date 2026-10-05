import { describe, expect, it } from 'vitest'

import { fromMinor } from '../../money/Money'
import { of } from '../../period/LocalDate'
import type { CategoryRule } from '../categorize/CategoryRule'
import type { Transaction } from '../types'

import {
  autoAddAccount,
  type AutoAddAccount,
  type AutoAddContext,
  autoAddCategory,
  candidateHolds,
  type LedgerProbe,
  ledgerHolds,
  ledgerWindow,
  transferPartner,
  withCurrentRules,
} from './autoAdd'
import { parseTransactionMessage } from './parseTransactionMessage'
import type { TransactionCandidate } from './TransactionCandidate'

// Messages are anonymised: real formats, invented values.

function rule(
  pattern: string,
  merchantLabel: string,
  categorySlug: string,
  confidence = 0.95,
): CategoryRule {
  return {
    id: `sys:${pattern}`,
    userId: null,
    pattern,
    matchType: 'contains',
    merchantLabel,
    categorySlug,
    confidence,
    priority: 100,
    isEnabled: true,
  }
}

const RULES = [
  rule('swiggy', 'Swiggy', 'food'),
  rule('payroll', 'Salary', 'salary'),
  rule('uber', 'Uber', 'transport', 0.85),
]
const CATEGORIES = [
  { slug: 'food', kind: 'expense' as const },
  { slug: 'transport', kind: 'expense' as const },
  { slug: 'shopping', kind: 'expense' as const },
  { slug: 'salary', kind: 'income' as const },
  { slug: 'other', kind: 'expense' as const },
]

const bank = (last4: string | null = null): AutoAddAccount => ({
  type: 'bank',
  last4,
  isArchived: false,
})
const CONTEXT: AutoAddContext = {
  enabled: true,
  currency: 'INR',
  accounts: [bank('1234'), { type: 'wallet', last4: null, isArchived: false }],
  categories: CATEGORIES,
}

function candidate(text: string, rules = RULES): TransactionCandidate {
  const result = parseTransactionMessage({
    text,
    rules,
    categories: CATEGORIES,
    receivedOn: of(2026, 10, 4),
  })
  if (result.status !== 'candidate') throw new Error(`no candidate: ${result.reason}`)
  return result.candidate
}

const SWIGGY = 'Sent Rs.486.00 From HDFC Bank A/C *1234 To SWIGGY On 03/10/26 Ref 900000000011'
const SALARY = 'Rs 52,000 credited to A/c XX1234 on 01-10-26 by NEFT from ACME PAYROLL'
const UBER = 'Sent Rs.250.00 From HDFC Bank A/C *1234 To UBER On 03/10/26 Ref 900000000014'
const PERSON =
  'Dear UPI user A/C X1234 debited by 150.00 on date 03Oct26 trf to Amit Refno 900000000402'
const UNKNOWN = 'UPI transaction of Rs 299 to UBER. Ref 900000000012'

describe('candidateHolds — what the message alone decides', () => {
  it('adds a clear payment: type, amount, payee, confident category, date and account all certain', () => {
    expect(candidateHolds(candidate(SWIGGY), CONTEXT)).toEqual([])
    expect(candidateHolds(candidate(SALARY), CONTEXT)).toEqual([])
  })

  it('holds everything when the user turned automatic adding off', () => {
    expect(candidateHolds(candidate(SWIGGY), { ...CONTEXT, enabled: false })).toEqual(['off'])
  })

  it('holds a payee with no category rule, and one whose rule is not confident enough', () => {
    expect(candidateHolds(candidate(PERSON), CONTEXT)).toEqual(['no_category'])
    expect(candidateHolds(candidate(UBER), CONTEXT)).toEqual(['no_category'])
  })

  it('holds a message that does not say which way the money went', () => {
    expect(candidateHolds(candidate(UNKNOWN), CONTEXT)).toContain('type_unknown')
  })

  it('holds a foreign-currency amount', () => {
    const usd = { ...candidate(SWIGGY), amount: fromMinor(4_86n, 'USD') }
    expect(candidateHolds(usd, CONTEXT)).toEqual(['foreign_currency'])
  })

  it('holds a candidate without a date, a payee, or with only the weak duplicate key', () => {
    const base = candidate(SWIGGY)
    expect(candidateHolds({ ...base, occurredOn: null }, CONTEXT)).toEqual(['no_date'])
    expect(candidateHolds({ ...base, merchant: null }, CONTEXT)).toEqual(['no_merchant'])
    const weak = { ...base, fingerprint: { ...base.fingerprint, basis: 'fields_undated' as const } }
    expect(candidateHolds(weak, CONTEXT)).toEqual(['weak_fingerprint'])
  })

  it('holds a category the user archived', () => {
    const archived = CATEGORIES.map((c) => (c.slug === 'food' ? { ...c, isArchived: true } : c))
    expect(candidateHolds(candidate(SWIGGY), { ...CONTEXT, categories: archived })).toEqual([
      'no_category',
    ])
  })
})

describe('autoAddAccount — never a guess', () => {
  const c = (accountLast4: string | null) => ({ accountLast4 })

  it('takes the one account whose digits the message shows', () => {
    const accounts = [bank('1234'), bank('5678')]
    expect(autoAddAccount(c('1234'), accounts)).toBe(accounts[0])
  })

  it('takes the only bank account when the user gave it no digits', () => {
    const accounts = [bank(null), { type: 'cash' as const, last4: null, isArchived: false }]
    expect(autoAddAccount(c('1234'), accounts)).toBe(accounts[0])
    expect(autoAddAccount(c(null), accounts)).toBe(accounts[0])
  })

  it('refuses digits that match no account — a card the user never added', () => {
    expect(autoAddAccount(c('9999'), [bank('1234')])).toBeNull()
  })

  it('refuses when several accounts could be the one', () => {
    expect(autoAddAccount(c(null), [bank('1234'), bank('5678')])).toBeNull()
    expect(autoAddAccount(c('1234'), [bank('1234'), bank('01234')])).toBeNull()
  })

  it('never picks cash, a goal wallet, or an archived account', () => {
    expect(
      autoAddAccount(c(null), [
        { type: 'cash', last4: null, isArchived: false },
        { type: 'wallet', last4: null, isArchived: false },
        { type: 'bank', last4: '1234', isArchived: true },
      ]),
    ).toBeNull()
  })

  it('accepts savings and credit-card accounts', () => {
    const card = { type: 'credit_card' as const, last4: '4321', isArchived: false }
    expect(autoAddAccount(c('4321'), [bank('1234'), card])).toBe(card)
  })
})

describe('withCurrentRules — a rule taught since the message arrived', () => {
  it('fills the category of a candidate parsed before the rule existed', () => {
    const before = candidate(PERSON)
    expect(before.category).toBeNull()
    const learned = { ...rule('amit', 'Amit', 'other'), userId: 'u1', matchType: 'exact' as const }
    const after = withCurrentRules(before, [...RULES, learned], CATEGORIES)
    expect(after.category?.categorySlug).toBe('other')
    expect(candidateHolds(after, CONTEXT)).toEqual([])
  })

  it('keeps a category the candidate already has', () => {
    const swiggy = candidate(SWIGGY)
    expect(withCurrentRules(swiggy, [rule('swiggy', 'Swiggy', 'shopping')], CATEGORIES)).toBe(
      swiggy,
    )
  })

  it('ignores a rule whose category is of the wrong kind', () => {
    const before = candidate(PERSON)
    expect(
      withCurrentRules(before, [rule('amit', 'Amit', 'salary')], CATEGORIES).category,
    ).toBeNull()
  })
})

describe('autoAddCategory', () => {
  it('needs the rule’s confidence to reach the form’s own pre-fill threshold', () => {
    expect(autoAddCategory(candidate(SWIGGY), CATEGORIES)?.categorySlug).toBe('food')
    expect(autoAddCategory(candidate(UBER), CATEGORIES)).toBeNull()
  })
})

// ----------------------------------------------------------------------------
// The ledger checks

function row(overrides: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    kind: 'expense',
    amount: fromMinor(50000n, 'INR'),
    accountId: 'acc-sbi',
    counterAccountId: null,
    categoryId: 'cat-food',
    merchantLabel: null,
    description: '',
    notes: null,
    occurredOn: of(2026, 10, 3),
    isSplit: false,
    splits: [],
    refundOfTransactionId: null,
    createdAt: '2026-10-03T10:00:00Z',
    updatedAt: '2026-10-03T10:00:00Z',
    deletedAt: null,
    ...overrides,
  }
}

const PROBE: LedgerProbe = {
  amount: fromMinor(50000n, 'INR'),
  kind: 'income',
  occurredOn: of(2026, 10, 3),
  accountId: 'acc-airtel',
  merchant: 'Self',
}

describe('ledgerHolds — what the ledger decides', () => {
  it('adds when nothing nearby is alike', () => {
    expect(ledgerHolds(PROBE, [row({ id: 't1', amount: fromMinor(12300n, 'INR') })])).toEqual([])
  })

  it('holds when the same amount and type is already there within a day — a typed entry, or a second chai', () => {
    expect(
      ledgerHolds(PROBE, [row({ id: 't1', kind: 'income', accountId: 'acc-airtel' })]),
    ).toEqual(['similar_exists'])
  })

  it('holds the second half of an own-account transfer: SBI debit, then Airtel credit', () => {
    const debit = row({ id: 't-debit', occurredOn: of(2026, 10, 2) })
    expect(ledgerHolds(PROBE, [debit])).toEqual(['possible_transfer'])
    expect(transferPartner(PROBE, [debit])).toBe(debit)
  })

  it('does not call it a transfer on the same account, beyond two days, or for another amount', () => {
    expect(transferPartner(PROBE, [row({ id: 'a', accountId: 'acc-airtel' })])).toBeNull()
    expect(transferPartner(PROBE, [row({ id: 'b', occurredOn: of(2026, 9, 30) })])).toBeNull()
    expect(transferPartner(PROBE, [row({ id: 'c', amount: fromMinor(50001n, 'INR') })])).toBeNull()
    expect(transferPartner(PROBE, [row({ id: 'd', deletedAt: '2026-10-03T11:00:00Z' })])).toBeNull()
  })

  it('takes the closest partner', () => {
    const far = row({ id: 'far', occurredOn: of(2026, 10, 1) })
    const near = row({ id: 'near', occurredOn: of(2026, 10, 3) })
    expect(transferPartner(PROBE, [far, near])).toBe(near)
  })

  it('never pairs a refund', () => {
    expect(transferPartner({ ...PROBE, kind: 'refund' }, [row({ id: 'r' })])).toBeNull()
  })

  it('asks for two days either side', () => {
    expect(ledgerWindow(of(2026, 10, 3))).toEqual({ from: of(2026, 10, 1), to: of(2026, 10, 5) })
  })
})
