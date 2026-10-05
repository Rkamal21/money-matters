import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_CATEGORIES } from '@/config/categories.generated'
import type { NewTransaction } from '@/data/repositories'
import { fromMinor } from '@/domain/money/Money'
import { of, toISO } from '@/domain/period/LocalDate'
import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import { parseTransactionMessage } from '@/domain/transactions/ingest/parseTransactionMessage'
import { confirmationRequestId } from '@/domain/transactions/ingest/review'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'
import type { AccountWithBalance, Category, Transaction } from '@/domain/transactions/types'

import { saveTransaction } from '../services/saveTransaction'

import {
  checkDraft,
  draftFromCandidate,
  type ReviewDraft,
  ruleFromReview,
  splitMessages,
  suggestionFor,
  toSaveInput,
} from './reviewDraft'

// ----------------------------------------------------------------------------
// Fixtures. Messages are anonymised: real formats, invented values.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const CATEGORIES: Category[] = DEFAULT_CATEGORIES.map((category, index) => ({
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
const categoryId = (slug: string) => CATEGORIES.find((category) => category.slug === slug)?.id

const inr = (minor: bigint) => fromMinor(minor, 'INR')

function account(
  overrides: Partial<AccountWithBalance> & Pick<AccountWithBalance, 'id' | 'name'>,
): AccountWithBalance {
  return {
    type: 'bank',
    currency: 'INR',
    openingBalance: inr(0n),
    creditLimit: null,
    institution: null,
    last4: null,
    isArchived: false,
    position: 0,
    updatedAt: '2026-10-01T00:00:00Z',
    balance: inr(0n),
    ...overrides,
  }
}

const WALLET = account({ id: uuid(1), name: 'Goal wallet', type: 'wallet' })
const SBI = account({ id: uuid(2), name: 'SBI', last4: '1234' })
const ICICI = account({ id: uuid(3), name: 'ICICI', last4: '0123' })
const OLD = account({ id: uuid(4), name: 'Closed', last4: '9999', isArchived: true })
const ACCOUNTS = [WALLET, SBI, ICICI, OLD]

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
const RULES = [
  rule('swiggy', 'Swiggy', 'food'),
  rule('amazon', 'Amazon', 'shopping'),
  rule('payroll', 'Salary', 'salary'),
]

const TODAY = of(2026, 10, 5)
const CONTEXT = { accounts: ACCOUNTS, categories: CATEGORIES, today: TODAY, currency: 'INR' }

function candidate(text: string): TransactionCandidate {
  const result = parseTransactionMessage({ text, rules: RULES, categories: CATEGORIES })
  if (result.status !== 'candidate') throw new Error(`no candidate: ${result.reason}`)
  return result.candidate
}

const SWIGGY = 'Sent Rs.486.00 From HDFC Bank A/C *1234 To SWIGGY On 03/10/26 Ref 900000000011'
const SALARY = 'Rs 52,000 credited to A/c XX1234 on 01-10-26 by NEFT from ACME PAYROLL'
const REFUND = 'Refund of Rs 300 from AMAZON credited to your A/c XX0123'
const UNKNOWN = 'UPI transaction of Rs 299 to UBER. Ref 900000000012'
const UNDATED = 'Airtel Payments Bank a/c is credited with Rs.250.00. Txn ID: 900000000013.'

// ----------------------------------------------------------------------------

describe('draftFromCandidate — parser → review candidate', () => {
  it('pre-fills an expense: amount, payee, category, the account it names, its date', () => {
    expect(draftFromCandidate(candidate(SWIGGY), CONTEXT)).toEqual({
      kind: 'expense',
      amount: '486',
      description: 'Swiggy',
      accountId: SBI.id,
      counterAccountId: '',
      categoryId: categoryId('food'),
      occurredOn: '2026-10-03',
      notes: '',
      isSplit: false,
      splits: [],
    })
  })

  it('pre-fills income with an income category', () => {
    const draft = draftFromCandidate(candidate(SALARY), CONTEXT)
    expect(draft.kind).toBe('income')
    expect(draft.categoryId).toBe(categoryId('salary'))
    expect(draft.description).toBe('Salary')
  })

  it('files a refund under an expense category', () => {
    const draft = draftFromCandidate(candidate(REFUND), CONTEXT)
    expect(draft.kind).toBe('refund')
    expect(draft.categoryId).toBe(categoryId('shopping'))
  })

  it('matches an account by the digits the message shows, even three of four', () => {
    const draft = draftFromCandidate(
      candidate('ICICI Bank Acct XX123 debited for Rs 75.00; BLINKIT credited.'),
      CONTEXT,
    )
    expect(draft.accountId).toBe(ICICI.id)
  })

  it('never picks an archived account, and falls back to the first non-wallet one', () => {
    expect(
      draftFromCandidate(candidate('Rs 50 paid to SWIGGY from A/c XX9999'), CONTEXT).accountId,
    ).toBe(SBI.id)
    expect(draftFromCandidate(candidate(UNDATED), CONTEXT).accountId).toBe(SBI.id)
    expect(
      draftFromCandidate(candidate(UNDATED), { ...CONTEXT, accounts: [WALLET] }).accountId,
    ).toBe(WALLET.id)
    expect(draftFromCandidate(candidate(UNDATED), { ...CONTEXT, accounts: [] }).accountId).toBe('')
  })

  it('leaves the type undecided when the direction is unknown — never an expense', () => {
    const draft = draftFromCandidate(candidate(UNKNOWN), CONTEXT)
    expect(draft.kind).toBe('')
    expect(draft.categoryId).toBe('')
  })

  it('uses today when the message has no date', () => {
    expect(draftFromCandidate(candidate(UNDATED), CONTEXT).occurredOn).toBe(toISO(TODAY))
  })

  it('leaves the amount blank for a message in another currency', () => {
    const draft = draftFromCandidate(
      candidate('USD 12.99 spent on card XX1234 at NETFLIX on 03-10-26'),
      CONTEXT,
    )
    expect(draft.amount).toBe('')
  })

  it('leaves the category blank when the user has no such category', () => {
    const withoutFood = CATEGORIES.filter((category) => category.slug !== 'food')
    expect(
      draftFromCandidate(candidate(SWIGGY), { ...CONTEXT, categories: withoutFood }).categoryId,
    ).toBe('')
  })
})

describe("suggestionFor — the entry form's own rule", () => {
  const base = { rules: RULES, categories: CATEGORIES }

  it('suggests a category of the right kind', () => {
    expect(suggestionFor({ ...base, description: 'Swiggy', kind: 'expense' })?.category.slug).toBe(
      'food',
    )
  })

  it.each<[string, string, '' | 'expense' | 'income' | 'transfer']>([
    ['an undecided type', 'Swiggy', ''],
    ['a transfer', 'Swiggy', 'transfer'],
    ['a one-letter description', 'S', 'expense'],
    ['no matching rule', 'Corner shop', 'expense'],
    ['a category of the wrong kind', 'Swiggy', 'income'],
  ])('suggests nothing for %s', (_case, description, kind) => {
    expect(suggestionFor({ ...base, description, kind })).toBeNull()
  })

  it('suggests nothing for an archived category', () => {
    const archived = CATEGORIES.map((category) =>
      category.slug === 'food' ? { ...category, isArchived: true } : category,
    )
    expect(
      suggestionFor({ rules: RULES, categories: archived, description: 'Swiggy', kind: 'expense' }),
    ).toBeNull()
  })
})

describe("checkDraft — the entry form's validation", () => {
  const valid = draftFromCandidate(candidate(SWIGGY), CONTEXT)
  const check = (draft: ReviewDraft) => checkDraft(draft, CONTEXT)

  it('accepts a complete draft', () => {
    expect(check(valid)).toEqual({ ok: true, values: { ...valid, kind: 'expense' } })
  })

  it('asks for the type when the message did not say', () => {
    expect(check({ ...valid, kind: '' })).toEqual({
      ok: false,
      errors: { kind: 'Choose the type: the message does not say which way the money went.' },
    })
  })

  it('reports each field the entry form would', () => {
    const result = check({ ...valid, amount: '', categoryId: '', accountId: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['accountId', 'amount', 'categoryId'])
      expect(result.errors.categoryId).toBe('Choose a category.')
    }
  })

  it('needs a destination for a transfer', () => {
    const result = check({ ...valid, kind: 'transfer', categoryId: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.counterAccountId).toBe('Choose where the money went.')
  })
})

describe("toSaveInput — the entry form's SaveInput", () => {
  const swiggy = candidate(SWIGGY)
  const context = {
    userId: 'user-1',
    candidate: swiggy,
    rules: RULES,
    categories: CATEGORIES,
    currency: 'INR',
  }
  const values = (draft: ReviewDraft) => {
    const result = checkDraft(draft, CONTEXT)
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    return result.values
  }
  const draft = draftFromCandidate(swiggy, CONTEXT)

  it("builds a new transaction keyed by the message's fingerprint", () => {
    expect(toSaveInput(values(draft), context)).toEqual({
      userId: 'user-1',
      existing: null,
      kind: 'expense',
      amount: inr(48600n),
      accountId: SBI.id,
      counterAccountId: null,
      categoryId: categoryId('food'),
      description: 'Swiggy',
      notes: null,
      occurredOn: of(2026, 10, 3),
      splits: null,
      clientRequestId: confirmationRequestId(swiggy.fingerprint),
      suggestion: expect.objectContaining({ categorySlug: 'food', merchantLabel: 'Swiggy' }),
      categories: CATEGORIES,
    })
  })

  it('carries every edit, and keeps the same key — an edit cannot dodge the duplicate check', () => {
    const edited = toSaveInput(
      values({
        ...draft,
        amount: '500',
        description: 'Swiggy Instamart',
        categoryId: categoryId('personal') ?? '',
      }),
      context,
    )
    expect(edited.amount).toEqual(inr(50000n))
    expect(edited.description).toBe('Swiggy Instamart')
    expect(edited.categoryId).toBe(categoryId('personal'))
    expect(edited.clientRequestId).toBe(confirmationRequestId(swiggy.fingerprint))
  })

  it('re-suggests from the edited payee, as the entry form does', () => {
    expect(
      toSaveInput(values({ ...draft, description: 'Corner shop' }), context).suggestion,
    ).toBeNull()
  })

  it('makes a transfer: no category, a destination account', () => {
    const transfer = toSaveInput(
      values({ ...draft, kind: 'transfer', categoryId: '', counterAccountId: ICICI.id }),
      context,
    )
    expect(transfer.categoryId).toBeNull()
    expect(transfer.counterAccountId).toBe(ICICI.id)
    expect(transfer.suggestion).toBeNull()
  })
})

describe('a confirmed candidate goes through saveTransaction — the manual write path', () => {
  function fakeLedger() {
    const rows = new Map<string, Transaction>()
    const created: NewTransaction[] = []
    const saveUserRule = vi.fn(() => Promise.resolve())
    const transactions = {
      // The real repository returns the existing row for a repeated key (DATABASE.md §12).
      create: (_userId: string, input: NewTransaction) => {
        created.push(input)
        const existing = rows.get(input.clientRequestId)
        if (existing !== undefined) return Promise.resolve(existing)
        const row: Transaction = {
          id: `tx-${rows.size + 1}`,
          kind: input.kind,
          amount: input.amount,
          accountId: input.accountId,
          counterAccountId: input.counterAccountId ?? null,
          categoryId: input.categoryId ?? null,
          merchantLabel: input.merchantLabel ?? null,
          description: input.description ?? '',
          notes: input.notes ?? null,
          occurredOn: input.occurredOn,
          isSplit: false,
          splits: [],
          refundOfTransactionId: null,
          createdAt: '2026-10-05T10:00:00Z',
          updatedAt: '2026-10-05T10:00:00Z',
          deletedAt: null,
        }
        rows.set(input.clientRequestId, row)
        return Promise.resolve(row)
      },
      replaceSplits: vi.fn(),
      update: vi.fn(),
    }
    const deps = { transactions, merchantRules: { saveUserRule } } as unknown as Parameters<
      typeof saveTransaction
    >[1]
    return { deps, rows, created, saveUserRule }
  }

  const confirm = (text: string, edit: Partial<ReviewDraft> = {}) => {
    const c = candidate(text)
    const result = checkDraft({ ...draftFromCandidate(c, CONTEXT), ...edit }, CONTEXT)
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    return toSaveInput(result.values, {
      userId: 'user-1',
      candidate: c,
      rules: RULES,
      categories: CATEGORIES,
      currency: 'INR',
    })
  }

  it('writes an expense with the merchant label the suggestion gives', async () => {
    const ledger = fakeLedger()
    const saved = await saveTransaction(confirm(SWIGGY), ledger.deps)
    expect(saved.kind).toBe('expense')
    expect(ledger.created[0]).toMatchObject({
      kind: 'expense',
      amount: inr(48600n),
      accountId: SBI.id,
      categoryId: categoryId('food'),
      merchantLabel: 'Swiggy',
      description: 'Swiggy',
    })
  })

  it('writes income', async () => {
    const ledger = fakeLedger()
    const saved = await saveTransaction(confirm(SALARY), ledger.deps)
    expect(saved).toMatchObject({
      kind: 'income',
      amount: inr(5200000n),
      categoryId: categoryId('salary'),
    })
  })

  it('writes one row for the same message confirmed twice, even edited the second time', async () => {
    const ledger = fakeLedger()
    const first = await saveTransaction(confirm(SWIGGY), ledger.deps)
    const second = await saveTransaction(confirm(SWIGGY, { amount: '999' }), ledger.deps)
    expect(second.id).toBe(first.id)
    expect(ledger.rows.size).toBe(1)
    expect(ledger.created[0]?.clientRequestId).toBe(ledger.created[1]?.clientRequestId)
  })

  it('learns from a corrected category, exactly as manual entry does', async () => {
    const ledger = fakeLedger()
    await saveTransaction(
      confirm(SWIGGY, { categoryId: categoryId('personal') ?? '' }),
      ledger.deps,
    )
    expect(ledger.saveUserRule).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ pattern: 'swiggy', categorySlug: 'personal' }),
    )
  })
})

describe('splitMessages — reading bank-messages.local', () => {
  it('takes one message per line, skipping blank lines and # notes', () => {
    expect(splitMessages('# notes\n\nRs 10 debited\r\n  Rs 20 credited  \n# HDFC\n')).toEqual([
      'Rs 10 debited',
      'Rs 20 credited',
    ])
  })
})

describe('ruleFromReview — what confirming teaches', () => {
  const PERSON =
    'Dear UPI user A/C X1234 debited by 150.00 on date 03Oct26 trf to Amit Refno 900000000402'
  const values = (overrides: Partial<ReturnType<typeof checkedValues>> = {}) => ({
    ...checkedValues(),
    ...overrides,
  })
  function checkedValues() {
    const check = checkDraft(
      { ...draftFromCandidate(candidate(PERSON), CONTEXT), categoryId: categoryId('other') ?? '' },
      { currency: 'INR', today: TODAY },
    )
    if (!check.ok) throw new Error('draft did not check')
    return check.values
  }

  it('learns a payee no rule knew, as an exact, confident personal rule', () => {
    expect(
      ruleFromReview({
        candidate: candidate(PERSON),
        values: values(),
        rules: RULES,
        categories: CATEGORIES,
      }),
    ).toEqual({
      pattern: 'amit',
      matchType: 'exact',
      merchantLabel: 'Amit',
      categorySlug: 'other',
      confidence: 0.95,
      priority: 10,
    })
  })

  it('raises a weak rule the person agreed with to a confident one, on its own pattern', () => {
    const weak = { ...rule('amit', 'Amit K', 'other'), confidence: 0.6 }
    const learned = ruleFromReview({
      candidate: candidate(PERSON),
      values: values(),
      rules: [...RULES, weak],
      categories: CATEGORIES,
    })
    expect(learned).toMatchObject({ pattern: 'amit', matchType: 'contains', confidence: 0.95 })
  })

  it('leaves a changed category to saveTransaction, and a confident rule alone', () => {
    const weak = { ...rule('amit', 'Amit K', 'shopping'), confidence: 0.6 }
    expect(
      ruleFromReview({
        candidate: candidate(PERSON),
        values: values(),
        rules: [...RULES, weak],
        categories: CATEGORIES,
      }),
    ).toBeNull()
    const swiggy = candidate(SWIGGY)
    const check = checkDraft(draftFromCandidate(swiggy, CONTEXT), { currency: 'INR', today: TODAY })
    if (!check.ok) throw new Error('draft did not check')
    expect(
      ruleFromReview({
        candidate: swiggy,
        values: check.values,
        rules: RULES,
        categories: CATEGORIES,
      }),
    ).toBeNull()
  })

  it('teaches nothing for a transfer', () => {
    expect(
      ruleFromReview({
        candidate: candidate(PERSON),
        values: values({ kind: 'transfer', counterAccountId: ICICI.id, categoryId: '' }),
        rules: RULES,
        categories: CATEGORIES,
      }),
    ).toBeNull()
  })
})
