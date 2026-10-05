import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORIES } from '@/config/categories.generated'

import { toMajorString } from '../../money/Money'
import { type LocalDate, of, toISO } from '../../period/LocalDate'
import type { CategoryRule } from '../categorize/CategoryRule'

import {
  CONFIDENCE_POINTS,
  MAX_MESSAGE_LENGTH,
  type ParseMessageInput,
  parseTransactionMessage,
} from './parseTransactionMessage'
import type { RejectionReason, TransactionCandidate } from './TransactionCandidate'

// ----------------------------------------------------------------------------
// Fixtures: the REAL system merchant rules (parsed from the migration that
// seeds them) and the real default categories — no hand-copied subset.

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../../..')

function systemRules(): CategoryRule[] {
  const sql = readFileSync(
    join(ROOT, 'supabase/migrations/20260910121000_merchant_rules.sql'),
    'utf8',
  )
  const block = sql.slice(
    sql.indexOf('>>> BEGIN SYSTEM MERCHANT RULES'),
    sql.indexOf('<<< END SYSTEM MERCHANT RULES'),
  )
  const row =
    /\('((?:[^']|'')+)', '(contains|prefix|exact)', '((?:[^']|'')+)', '([a-z_]+)', ([\d.]+)\)/g
  return Array.from(block.matchAll(row), (match) => ({
    id: `sys:${match[1]}`,
    userId: null,
    pattern: match[1]!.replace(/''/g, "'"),
    matchType: match[2] as CategoryRule['matchType'],
    merchantLabel: match[3]!.replace(/''/g, "'"),
    categorySlug: match[4]!,
    confidence: Number(match[5]),
    priority: 100,
    isEnabled: true,
  }))
}

const RULES = systemRules()

function parse(text: string, extra: Partial<ParseMessageInput> = {}) {
  return parseTransactionMessage({ text, rules: RULES, categories: DEFAULT_CATEGORIES, ...extra })
}

function candidate(text: string, extra: Partial<ParseMessageInput> = {}): TransactionCandidate {
  const result = parse(text, extra)
  if (result.status !== 'candidate') {
    throw new Error(`expected a candidate, got "${result.reason}" for: ${text}`)
  }
  return result.candidate
}

function rejection(text: string): RejectionReason | 'candidate' {
  const result = parse(text)
  return result.status === 'rejected' ? result.reason : 'candidate'
}

/** "486.00 INR" style summary of the amount. */
const amountOf = (c: TransactionCandidate): string =>
  `${c.amount.currency} ${toMajorString(c.amount)}`

const iso = (date: LocalDate | null): string | null => (date === null ? null : toISO(date))

// ----------------------------------------------------------------------------

describe('fixtures', () => {
  it('parsed every system merchant rule from the migration', () => {
    expect(RULES.length).toBeGreaterThan(50)
    expect(RULES.find((rule) => rule.pattern === 'swiggy')?.categorySlug).toBe('food')
  })
})

describe('1. expense messages', () => {
  it.each([
    [
      'Rs.486.00 debited from A/c XX1234 for UPI transaction to SWIGGY',
      'INR 486',
      'Swiggy',
      'food',
    ],
    ['INR 1,250.00 spent on your card at AMAZON', 'INR 1250', 'Amazon', 'shopping'],
    [
      'Your account XX1234 is debited by Rs 500.00 towards UPI payment to ZOMATO',
      'INR 500',
      'Zomato',
      'food',
    ],
    ['UPI txn of Rs. 299 paid to Uber', 'INR 299', 'Uber', 'transport'],
  ])('%j', (text, amount, merchant, category) => {
    const c = candidate(text)
    expect(c.direction).toBe('expense')
    expect(c.kind).toBe('expense')
    expect(amountOf(c)).toBe(amount)
    expect(c.merchant).toBe(merchant)
    expect(c.category?.categorySlug).toBe(category)
  })

  it('reads a purchase, a withdrawal, a deduction and a charge as expenses', () => {
    expect(candidate('Purchase of Rs 999 at DECATHLON on card XX1234').direction).toBe('expense')
    expect(candidate('Rs 2,000 withdrawn from A/c XX1234 at ATM').direction).toBe('expense')
    expect(candidate('Rs 18 deducted from A/c XX1234 as SMS charges').direction).toBe('expense')
    expect(candidate('Rs 99 charged to card XX1234 for SPOTIFY').merchant).toBe('Spotify')
  })

  it('reads app-style "payment successful" as an expense', () => {
    const c = candidate('Payment of Rs 349 to BOOKMYSHOW successful. UPI Ref 427612345678')
    expect(c.direction).toBe('expense')
    expect(c.merchant).toBe('BookMyShow')
  })
})

describe('2. income messages', () => {
  it.each([
    ['Rs 2,000 credited to your account', 'INR 2000'],
    ['INR 750 received via UPI', 'INR 750'],
    ['Rs 5,000 deposited in A/c XX1234 by cash', 'INR 5000'],
    ['Credit of Rs 1,500 in your A/c XX1234', 'INR 1500'],
  ])('%j', (text, amount) => {
    const c = candidate(text)
    expect(c.direction).toBe('income')
    expect(c.kind).toBe('income')
    expect(amountOf(c)).toBe(amount)
  })

  it('reads "paid you" and "sent you" as money in, not out', () => {
    expect(candidate('RAHUL paid you ₹500 on Google Pay. UPI Ref 427612345678').direction).toBe(
      'income',
    )
    expect(candidate('PRIYA sent you Rs 250. UPI Ref 427612345678').direction).toBe('income')
  })

  it('names the payer of a credit', () => {
    const c = candidate(
      'Money Received - INR 2,000.00 in your A/c XX1234 on 03-10-26 from RAHUL SHARMA. UPI Ref 427612345678',
    )
    expect(c.merchant).toBe('Rahul Sharma')
    expect(c.merchantRaw).toBe('RAHUL SHARMA')
  })

  it('files a completed refund as a refund: money in, under an expense category', () => {
    const c = candidate('Refund of Rs 300 from AMAZON credited to your A/c XX1234')
    expect(c.direction).toBe('income')
    expect(c.kind).toBe('refund')
    expect(c.merchant).toBe('Amazon')
    expect(c.merchantRaw).toBe('AMAZON')
    expect(c.category?.categorySlug).toBe('shopping')
  })

  it('treats a reversal as a refund', () => {
    expect(
      candidate('Rs 500 reversed to your A/c XX1234 for failed UPI txn Ref 427612345678').kind,
    ).toBe('refund')
    expect(candidate('Rs 120 credited back to card XX1234 for order 8812').kind).toBe('refund')
  })
})

describe('3. UPI messages — real bank formats', () => {
  it.each([
    [
      'SBI',
      'Dear UPI user A/C X1234 debited by 500.0 on date 03Oct26 trf to SWIGGY Refno 427612345678. If not u? call 1800111109. -SBI',
    ],
    [
      'ICICI',
      'ICICI Bank Acct XX1234 debited for Rs 500.00 on 03-Oct-26; SWIGGY credited. UPI:427612345678. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766.',
    ],
    [
      'HDFC',
      'Sent Rs.500.00 From HDFC Bank A/C *1234 To SWIGGY On 03/10/26 Ref 427612345678 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808',
    ],
    [
      'Axis',
      'Debit INR 500.00 A/c no. XX1234 03-10-26 14:22:11 UPI/P2M/427612345678/SWIGGY Not you? SMS BLOCK 1234 to 919951860002 Axis Bank',
    ],
    [
      'Kotak',
      'Sent Rs.500.00 from Kotak Bank AC X1234 to swiggy.upi@axisbank on 03-10-26.UPI Ref 427612345678',
    ],
  ])('%s', (_bank, text) => {
    const c = candidate(text)
    expect(c.direction).toBe('expense')
    expect(amountOf(c)).toBe('INR 500')
    expect(c.merchant).toBe('Swiggy')
    expect(c.category?.categorySlug).toBe('food')
    expect(c.reference).toBe('427612345678')
    expect(c.accountLast4).toBe('1234')
    expect(iso(c.occurredOn)).toBe('2026-10-03')
    expect(c.confidence.score).toBe(100)
  })

  it('gives the same transaction the same fingerprint whichever bank wrote it', () => {
    const fingerprints = new Set(
      [
        'Dear UPI user A/C X1234 debited by 500.0 on date 03Oct26 trf to SWIGGY Refno 427612345678.',
        'Sent Rs.500.00 From HDFC Bank A/C *1234 To SWIGGY On 03/10/26 Ref 427612345678',
        'Debit INR 500.00 A/c no. XX1234 03-10-26 UPI/P2M/427612345678/SWIGGY Not you?',
      ].map((text) => candidate(text).fingerprint.value),
    )
    expect(fingerprints.size).toBe(1)
  })

  it('reads a payee from a VPA', () => {
    const c = candidate('Rs 120 paid to VPA zomato@icici. UPI Ref 427612345678')
    expect(c.merchantRaw).toBe('zomato@icici')
    expect(c.merchant).toBe('Zomato')
  })

  it('reads the payer from an HDFC-style "Info: UPI/…" credit', () => {
    const c = candidate('Rs 800 credited to A/c XX1234. Info: UPI/P2A/427612345678/RAHUL SHARMA.')
    expect(c.direction).toBe('income')
    expect(c.merchant).toBe('Rahul Sharma')
    expect(c.reference).toBe('427612345678')
  })
})

/**
 * Real messages, anonymised. The wording, spacing and punctuation are exactly
 * as the banks sent them; every amount, account digit, name, reference,
 * balance and date has been replaced. Never paste an unredacted message here.
 */
describe('real message formats (anonymised)', () => {
  it.each([
    {
      bank: 'Airtel Payments Bank debit',
      text: 'Rs. 40.00 debited from Airtel Payments Bank a/c Txn ID 900000000001 Bal:512.40 Call 180023400 for help',
      direction: 'expense',
      amount: 'INR 40',
      merchant: null,
      reference: '900000000001',
      account: null,
      date: null,
      score: 65,
    },
    {
      bank: 'Airtel Payments Bank credit',
      text: 'Airtel Payments Bank a/c is credited with Rs.250.00. Txn ID: 900000000002. Call 180023400 for help',
      direction: 'income',
      amount: 'INR 250',
      merchant: null,
      reference: '900000000002',
      account: null,
      date: null,
      score: 65,
    },
    {
      bank: 'SBI UPI debit, one-word payee',
      text: 'Dear UPI user A/C X1234 debited by 250.00 on date 02Oct26 trf to Amit Refno 900000000003 If not u? call-1800111109 for other services-18001234-SBI',
      direction: 'expense',
      amount: 'INR 250',
      merchant: 'Amit',
      reference: '900000000003',
      account: '1234',
      date: '2026-10-02',
      score: 90,
    },
    {
      bank: 'SBI UPI debit, two-word payee',
      text: 'Dear UPI user A/C X1234 debited by 75.00 on date 07Sep26 trf to PRIYA SHARMA Refno 900000000004 If not u? call-1800111109 for other services-18001234-SBI',
      direction: 'expense',
      amount: 'INR 75',
      merchant: 'Priya Sharma',
      reference: '900000000004',
      account: '1234',
      date: '2026-09-07',
      score: 90,
    },
  ])('$bank', ({ text, direction, amount, merchant, reference, account, date, score }) => {
    const c = candidate(text)
    expect(c.direction).toBe(direction)
    expect(amountOf(c)).toBe(amount)
    expect(c.merchant).toBe(merchant)
    expect(c.reference).toBe(reference)
    expect(c.accountLast4).toBe(account)
    expect(iso(c.occurredOn)).toBe(date)
    expect(c.confidence.score).toBe(score)
  })

  it('reads neither the bank\'s name nor its "Bal:" figure as part of the transaction', () => {
    const c = candidate(
      'Rs. 40.00 debited from Airtel Payments Bank a/c Txn ID 900000000001 Bal:512.40 Call 180023400 for help',
    )
    expect(c.category).toBeNull()
    expect(c.merchant).toBeNull()
    expect(amountOf(c)).toBe('INR 40')
  })

  it('returns the two halves of an own-account transfer as two candidates (ROADMAP.md M12)', () => {
    // Mirrors a real SBI → Airtel Payments Bank transfer: the banks' references
    // for the same transfer differ, so nothing here can link them. Pairing
    // needs both messages and belongs to the review step.
    const out = candidate(
      'Dear UPI user A/C X1234 debited by 250.00 on date 02Oct26 trf to Amit Refno 900000000003 If not u? call-1800111109 for other services-18001234-SBI',
    )
    const back = candidate(
      'Airtel Payments Bank a/c is credited with Rs.250.00. Txn ID: 900000000002. Call 180023400 for help',
    )
    expect([out.direction, back.direction]).toEqual(['expense', 'income'])
    expect(amountOf(out)).toBe(amountOf(back))
    expect(out.reference).not.toBe(back.reference)
    expect(out.fingerprint.value).not.toBe(back.fingerprint.value)
  })
})

describe('4. card transaction messages', () => {
  it('reads an HDFC card alert, skipping the available limit', () => {
    const c = candidate(
      'Rs 1,250.00 spent on HDFC Bank Card XX1234 at AMAZON on 2026-10-03:14:22:11. Avl Lmt: Rs 45,000',
    )
    expect(amountOf(c)).toBe('INR 1250')
    expect(c.merchant).toBe('Amazon')
    expect(c.accountLast4).toBe('1234')
    expect(iso(c.occurredOn)).toBe('2026-10-03')
    expect(c.occurredTime).toBe('14:22')
  })

  it('does not read "credit card" or "debit card" as a direction', () => {
    expect(candidate('Rs 1,250 spent on Credit Card XX1234 at MYNTRA').direction).toBe('expense')
    expect(candidate('Rs 300 refunded to your Debit Card XX1234 by FLIPKART').kind).toBe('refund')
  })

  it('does not read "available credit" as a credit', () => {
    const c = candidate('Rs 500 spent on card ending 1234 at ZOMATO. Available credit Rs 20,000')
    expect(c.direction).toBe('expense')
    expect(amountOf(c)).toBe('INR 500')
    expect(c.accountLast4).toBe('1234')
  })

  it('reads an international card spend in its own currency', () => {
    const c = candidate('USD 12.99 spent on card XX1234 at NETFLIX.COM on 03-10-26')
    expect(amountOf(c)).toBe('USD 12.99')
    expect(c.merchant).toBe('Netflix')
  })
})

describe('5. amount extraction', () => {
  it.each([
    ['₹486 debited from A/c XX1234', 'INR 486'],
    ['Rs486 debited from A/c XX1234', 'INR 486'],
    ['Rs.486.00 debited from A/c XX1234', 'INR 486'],
    ['Rs. 486.5 debited from A/c XX1234', 'INR 486.50'],
    ['INR 1,25,000.75 debited from A/c XX1234', 'INR 125000.75'],
    ['INR1,250 debited from A/c XX1234', 'INR 1250'],
    ['Rs 12,34,567 credited to A/c XX1234', 'INR 1234567'],
  ])('%j → %s', (text, amount) => {
    expect(amountOf(candidate(text))).toBe(amount)
  })

  it('takes the transaction amount, not the balance after it', () => {
    expect(amountOf(candidate('Rs 500 debited from A/c XX1234. Avl Bal Rs 12,345.67'))).toBe(
      'INR 500',
    )
  })

  it('skips a balance that comes first', () => {
    expect(
      amountOf(candidate('Avl Bal Rs 10,000.00 in A/c XX1234 after Rs 250 debited to ZEPTO')),
    ).toBe('INR 250')
  })

  it('reads SBI amounts that carry no currency marker', () => {
    expect(
      amountOf(
        candidate('Your A/c X1234 credited by 1500.50 on 03Oct26 by RAHUL Refno 427612345678'),
      ),
    ).toBe('INR 1500.50')
  })

  it('skips a zero or malformed amount and uses the next one', () => {
    expect(amountOf(candidate('Rs 0.00 hold released. Rs 250 debited from A/c XX1234'))).toBe(
      'INR 250',
    )
    expect(amountOf(candidate('Rs 10.505 noted. Rs 250 debited from A/c XX1234'))).toBe('INR 250')
  })

  it('rejects a message whose only amounts are zero or malformed', () => {
    expect(rejection('Rs 0.00 debited from A/c XX1234')).toBe('no_amount')
    expect(rejection('Rs 10.505 debited from A/c XX1234')).toBe('no_amount')
  })

  it('always returns a positive amount: the direction carries the sign', () => {
    expect(candidate('Rs 500 debited from A/c XX1234').amount.minor).toBe(50000n)
  })
})

describe('6. merchant extraction', () => {
  it('stops at "on", "Ref", punctuation and dates', () => {
    expect(candidate('Rs 500 paid to SWIGGY on 03-10-26').merchantRaw).toBe('SWIGGY')
    expect(candidate('Rs 500 paid to SWIGGY Ref 427612345678').merchantRaw).toBe('SWIGGY')
    expect(candidate('Rs 500 paid to SWIGGY. Avl Bal Rs 100').merchantRaw).toBe('SWIGGY')
    expect(candidate('Rs 500 paid to SWIGGY, thank you').merchantRaw).toBe('SWIGGY')
    expect(candidate('A/c X1234 debited by 500 trf to SWIGGY 03-10-26').merchantRaw).toBe('SWIGGY')
  })

  it('keeps a multi-word payee whole', () => {
    const c = candidate('Rs 240 paid to SHREE GANESH GENERAL STORES on 03-10-26')
    expect(c.merchantRaw).toBe('SHREE GANESH GENERAL STORES')
    expect(c.merchant).toBe('Shree Ganesh General Stores')
    expect(c.category).toBeNull()
  })

  it('caps a payee at five words', () => {
    expect(candidate('Rs 240 paid to ONE TWO THREE FOUR FIVE SIX SEVEN').merchantRaw).toBe(
      'ONE TWO THREE FOUR FIVE',
    )
  })

  it('skips payment vocabulary and keeps looking: "for UPI transaction to SWIGGY"', () => {
    expect(candidate('Rs 99 debited for UPI transaction to SWIGGY').merchantRaw).toBe('SWIGGY')
    expect(candidate('Rs 99 debited for bill payment to AIRTEL').merchantRaw).toBe('AIRTEL')
  })

  it("does not take the user's own account, a card or an amount for a payee", () => {
    const c = candidate('Rs 500 debited from your A/c XX1234 and sent to your A/c XX5678')
    expect(c.merchant).toBeNull()
    expect(candidate('Rs 500 debited for Rs 500 at card XX1234').merchant).toBeNull()
  })

  it('ignores helpline footers: "Call 1800… for dispute"', () => {
    expect(
      candidate('Rs 500 debited from A/c XX1234. Call 18002662 for dispute').merchant,
    ).toBeNull()
  })

  it('finds no payee when a prefix ends the message', () => {
    expect(candidate('Rs 500 debited from A/c XX1234 and paid to').merchant).toBeNull()
  })

  it('reads ICICI\'s "<payee> credited" form and a payee after M/s', () => {
    expect(candidate('Acct XX1234 debited for Rs 75.00; BLINKIT credited.').merchant).toBe(
      'Blinkit',
    )
    expect(candidate('Rs 1,200 paid to M/s. DMART on 03-10-26').merchant).toBe('DMart')
  })

  it('falls back to "from" when the direction is unknown', () => {
    const c = candidate('UPI transaction of Rs 40 from RAMESH KUMAR. Ref 427612345678')
    expect(c.direction).toBe('unknown')
    expect(c.merchant).toBe('Ramesh Kumar')
  })

  it('tries the payee of a refund after "for" when there is no "from"', () => {
    expect(candidate('Refund of Rs 300 for MYNTRA order credited to A/c XX1234').merchant).toBe(
      'Myntra',
    )
  })

  it('rejects a payee that is only a reference number', () => {
    expect(candidate('Rs 500 paid to 9876543210@ybl. UPI Ref 427612345678').merchant).toBeNull()
  })
})

describe('7. debit / credit detection', () => {
  it.each(['debited', 'spent', 'paid', 'withdrawn', 'deducted', 'charged'])(
    '"%s" is an expense',
    (word) => {
      expect(candidate(`Rs 100 ${word} from A/c XX1234`).direction).toBe('expense')
    },
  )

  it.each(['debit of', 'purchase of', 'payment made of'])('"%s" is an expense', (phrase) => {
    expect(candidate(`A ${phrase} Rs 100 on A/c XX1234`).direction).toBe('expense')
  })

  it.each(['credited', 'received', 'deposited'])('"%s" is income', (word) => {
    expect(candidate(`Rs 100 ${word} in A/c XX1234`).direction).toBe('income')
  })

  it('"refund received" is a refund', () => {
    expect(candidate('Refund received: Rs 100 in A/c XX1234').kind).toBe('refund')
  })

  it('lets a debit win only when every credit names the payee', () => {
    expect(candidate('Rs 500 debited from your A/c XX1234 and credited to SWIGGY').direction).toBe(
      'expense',
    )
  })

  it("keeps a transfer between the user's own accounts unknown", () => {
    const c = candidate('Rs 500 debited from A/c XX1234 and credited to your A/c XX5678')
    expect(c.direction).toBe('unknown')
    expect(c.kind).toBeNull()
  })

  it('keeps a credit followed by a debit unknown', () => {
    expect(
      candidate('Rs 500 credited to A/c XX1234; Rs 500 debited from A/c XX5678').direction,
    ).toBe('unknown')
  })
})

describe('8. category suggestions — the existing merchant rules', () => {
  it.each([
    ['SWIGGY', 'Swiggy', 'food'],
    ['ZOMATO', 'Zomato', 'food'],
    ['UBER INDIA SYSTEMS', 'Uber', 'transport'],
    ['AMAZON PAY INDIA', 'Amazon', 'shopping'],
    ['NETFLIX', 'Netflix', 'entertainment'],
  ])('%s → %s → %s', (payee, merchant, category) => {
    const c = candidate(`Rs 100 paid to ${payee} on 03-10-26`)
    expect(c.merchant).toBe(merchant)
    expect(c.category?.categorySlug).toBe(category)
    expect(c.category?.source).toBe('system')
  })

  it("uses the user's own rule over the system rule", () => {
    const mine: CategoryRule = {
      id: 'u1:swiggy',
      userId: 'u1',
      pattern: 'swiggy',
      matchType: 'contains',
      merchantLabel: 'Swiggy (office)',
      categorySlug: 'personal',
      confidence: 0.95,
      priority: 10,
      isEnabled: true,
    }
    const c = candidate('Rs 100 paid to SWIGGY', { rules: [...RULES, mine] })
    expect(c.category?.categorySlug).toBe('personal')
    expect(c.category?.source).toBe('user')
    expect(c.merchant).toBe('Swiggy (office)')
  })

  it('never suggests an expense category for income', () => {
    const c = candidate('Rs 100 received from AMAZON in A/c XX1234')
    expect(c.merchant).toBe('Amazon')
    expect(c.category).toBeNull()
  })

  it('never suggests an income category for an expense', () => {
    expect(candidate('Rs 100 paid to ACME PAYROLL SERVICES').category).toBeNull()
  })

  it('finds salary in an income message with no payee', () => {
    const c = candidate('Rs 52,000 credited to A/c XX1234 on 01-10-26 - SALARY OCT')
    expect(c.merchant).toBeNull()
    expect(c.category?.categorySlug).toBe('salary')
  })

  it('reads salary from the payer when there is one', () => {
    const c = candidate('Your A/c XX1234 is credited with Rs 52,000 by NEFT from ACME PAYROLL.')
    expect(c.category?.categorySlug).toBe('salary')
  })

  it('does not search an expense message for merchant names', () => {
    expect(candidate('Rs 100 debited from Airtel Payments Bank A/c XX1234').category).toBeNull()
  })

  it('suggests nothing while the direction is unknown', () => {
    const c = candidate('UPI transaction of Rs 299 to UBER. Ref 427612345678')
    expect(c.direction).toBe('unknown')
    expect(c.merchant).toBe('Uber')
    expect(c.category).toBeNull()
  })

  it('suggests nothing when the user has no category with that slug', () => {
    expect(candidate('Rs 100 paid to SWIGGY', { categories: [] }).category).toBeNull()
  })
})

describe('9. confidence — explainable evidence points', () => {
  it('has points that sum to 100', () => {
    expect(Object.values(CONFIDENCE_POINTS).reduce((sum, points) => sum + points, 0)).toBe(100)
  })

  it('itemises the score: the score is exactly the sum of the breakdown', () => {
    const c = candidate('Rs.486.00 debited from A/c XX1234 for UPI transaction to SWIGGY')
    expect(c.confidence.breakdown).toEqual([
      { factor: 'amount', points: 30 },
      { factor: 'direction', points: 25 },
      { factor: 'merchant', points: 15 },
      { factor: 'category', points: 10 },
      { factor: 'account', points: 5 },
    ])
    expect(c.confidence.score).toBe(85)
    expect(c.confidence.level).toBe('high')
  })

  it.each([
    [
      'Dear UPI user A/C X1234 debited by 500.0 on date 03Oct26 trf to SWIGGY Refno 427612345678',
      100,
      'high',
    ],
    ['UPI txn of Rs. 299 paid to Uber', 80, 'high'],
    ['Rs 240 paid to SHREE GANESH STORES', 70, 'medium'],
    ['Rs 2,000 credited to your account', 55, 'medium'],
    ['UPI transaction of Rs 299 with Uber, Ref 427612345678', 40, 'low'],
  ])('%j → %i (%s)', (text, score, level) => {
    const c = candidate(text)
    expect(c.confidence.score).toBe(score)
    expect(c.confidence.level).toBe(level)
  })

  it('never rates an unknown direction high, whatever else it found', () => {
    const c = candidate(
      'UPI transaction of Rs 299 to UBER on 03-10-26 from A/c XX1234. Ref 427612345678',
    )
    expect(c.direction).toBe('unknown')
    expect(c.confidence.level).not.toBe('high')
  })

  it('does not count a date that only came from the arrival day', () => {
    const c = candidate('Rs 2,000 credited to your account', { receivedOn: of(2026, 10, 3) })
    expect(c.confidence.breakdown.map((item) => item.factor)).not.toContain('date')
  })
})

describe('10. fingerprints on candidates', () => {
  it('uses the reference when the message has one', () => {
    expect(candidate('Rs 500 paid to SWIGGY. UPI Ref 427612345678').fingerprint.basis).toBe(
      'reference',
    )
  })

  it('uses the fields when it does not — dated from the message or the arrival day', () => {
    expect(candidate('Rs 500 paid to SWIGGY on 03-10-26').fingerprint.basis).toBe('fields')
    expect(
      candidate('Rs 500 paid to SWIGGY', { receivedOn: of(2026, 10, 3) }).fingerprint.basis,
    ).toBe('fields')
    expect(candidate('Rs 500 paid to SWIGGY').fingerprint.basis).toBe('fields_undated')
  })

  it('matches a re-delivered message and the same payment worded differently', () => {
    const a = candidate('Rs 500 paid to SWIGGY on 03-10-26 from A/c XX1234')
    const b = candidate('Rs 500.00 debited from A/c XX1234 on 03-Oct-26 to swiggy.upi@axisbank')
    expect(a.fingerprint.value).toBe(b.fingerprint.value)
  })

  it('keys an SMS with no reference by its send time: one SMS, one key', () => {
    const text = 'Rs 1,250.00 spent on card XX1234 at AMAZON on 03-10-26'
    const first = candidate(text, { sentAt: 1_790_000_000_000 })
    expect(first.fingerprint.basis).toBe('message')
    // The same SMS delivered twice is one transaction…
    expect(candidate(text, { sentAt: 1_790_000_000_000 }).fingerprint.value).toBe(
      first.fingerprint.value,
    )
    // …but a second, identically worded ₹1,250 payment is not collapsed into it.
    expect(candidate(text, { sentAt: 1_790_000_360_000 }).fingerprint.value).not.toBe(
      first.fingerprint.value,
    )
  })

  it('keys by the bank reference, whatever the send time', () => {
    const text = 'Rs 500 paid to SWIGGY. UPI Ref 427612345678'
    expect(candidate(text, { sentAt: 1 }).fingerprint).toEqual(
      candidate(text, { sentAt: 2 }).fingerprint,
    )
  })

  it('tells two different payments apart', () => {
    const a = candidate('Rs 500 paid to SWIGGY on 03-10-26')
    expect(candidate('Rs 501 paid to SWIGGY on 03-10-26').fingerprint.value).not.toBe(
      a.fingerprint.value,
    )
    expect(candidate('Rs 500 paid to SWIGGY on 04-10-26').fingerprint.value).not.toBe(
      a.fingerprint.value,
    )
  })
})

describe('11. OTP messages are rejected', () => {
  it.each([
    '123456 is your OTP for login. Do not share it with anyone.',
    'Your OTP for transaction of Rs 2,500.00 at AMAZON is 482913. Valid for 5 mins.',
    'OTP: 4821 for payment of Rs 999 to FLIPKART. Never share it.',
    'Use OTP 4821 to verify your HDFC Bank card XX1234',
    'Your one time password is 739201 for debit of Rs 5,000',
    '738291 is the verification code for your UPI PIN reset',
  ])('%j', (text) => {
    expect(rejection(text)).toBe('otp')
  })

  it('keeps a real transaction whose footer only warns about OTPs', () => {
    expect(
      candidate('Rs 500 debited from A/c *1234 to SWIGGY. Never share your OTP or PIN with anyone.')
        .direction,
    ).toBe('expense')
  })
})

describe('12. promotional messages are rejected', () => {
  it.each([
    'Congratulations! You have won Rs 5,000. Claim now at http://x.co',
    'Your loan of Rs 2,00,000 is pre-approved. Apply now!',
    'Flat 20% cashback on Swiggy orders above Rs 299',
    'Get up to Rs 500 off on your first order. Use code SAVE500',
    'Hurry! Limited time offer: Netflix at Rs 199. Subscribe now',
    'Lucky draw: Rs 10,000 credited to winners. Click here',
    'Rs 50 cashback on recharge above Rs 299. T&C apply',
    'Exclusive offers on HDFC cards at www.example.com from Rs 99',
  ])('%j', (text) => {
    expect(rejection(text)).toBe('promotional')
  })

  it('keeps a real credit that mentions cashback', () => {
    expect(candidate('Cashback of Rs 50 credited to your Paytm wallet').direction).toBe('income')
  })
})

describe('13. balance-only messages are rejected', () => {
  it.each([
    'Your A/c XX1234 balance is Rs 10,000 as on 03-Oct',
    'Avl Bal in A/c XX1234 is INR 5,432.10 on 03-10-26',
    'Available balance: Rs 12,000. Outstanding: Rs 3,000',
    'Your card XX1234 has an available limit of Rs 45,000',
  ])('%j', (text) => {
    expect(rejection(text)).toBe('balance_only')
  })
})

describe('14. malformed messages', () => {
  it.each<[string, RejectionReason]>([
    ['', 'empty'],
    ['   \n\t  ', 'empty'],
    ['!!!', 'no_amount'],
    ['₹₹₹ debited', 'no_amount'],
    ['Rs debited from A/c XX1234', 'no_amount'],
    ['Your A/c XX1234 has been debited', 'no_amount'],
    ['1234 5678 9012', 'no_amount'],
    ['Rs 500', 'insufficient_evidence'],
    ['Rs.486.00 debi', 'insufficient_evidence'],
  ])('%j → %s', (text, reason) => {
    expect(rejection(text)).toBe(reason)
  })

  it('rejects anything longer than a bank message', () => {
    expect(rejection(`Rs 500 debited ${'x'.repeat(MAX_MESSAGE_LENGTH)}`)).toBe('too_long')
  })

  it('does not throw on hostile input', () => {
    for (const text of ['(((((((((', '\\u0000', 'Rs ' + '9'.repeat(40) + ' debited', '%s%n%x']) {
      expect(() => parse(text)).not.toThrow()
    }
  })

  it('rejects an amount too large to be real', () => {
    expect(rejection(`Rs ${'9'.repeat(20)} debited from A/c XX1234`)).toBe('no_amount')
  })
})

describe('15. ambiguous messages', () => {
  it('returns unknown — not an expense — for a transaction with no direction word', () => {
    const c = candidate('UPI transaction of Rs 299 with Uber, Ref 427612345678')
    expect(c.direction).toBe('unknown')
    expect(c.kind).toBeNull()
  })

  it('keeps a card bill payment unknown: it is neither income nor a new expense', () => {
    expect(
      candidate('Payment of Rs 5,000 received towards your Credit Card XX1234').direction,
    ).toBe('unknown')
    expect(candidate('Thank you! We have received your payment of Rs 1,250').direction).toBe(
      'unknown',
    )
    expect(candidate('Payment of Rs 5,000 credited to your card XX1234').direction).toBe('unknown')
  })

  it('rejects an amount with no sign of a transaction at all', () => {
    expect(rejection('Rs 500 for you')).toBe('insufficient_evidence')
  })
})

describe('money that has not moved', () => {
  it.each([
    'Rs 499 will be debited on 05-Oct for Netflix autopay',
    'Your bill of Rs 499 is due on 05-Oct',
    'RAHUL has requested Rs 500 from you on Google Pay',
    'You have received a collect request of Rs 500 from RAHUL',
    'Refund of Rs 300 has been initiated for your order',
    'Reminder: EMI of Rs 2,000 scheduled for 05-10-26',
  ])('%j → not_completed', (text) => {
    expect(rejection(text)).toBe('not_completed')
  })

  it('reads the completed part of a message that also mentions a future one', () => {
    const c = candidate(
      'Rs 500 debited from A/c XX1234. Cashback of Rs 50 will be credited in 48 hrs',
    )
    expect(c.direction).toBe('expense')
    expect(amountOf(c)).toBe('INR 500')
  })
})

describe('failed transactions', () => {
  it.each([
    'UPI txn of Rs 500 failed. Amount, if debited, will be refunded in 48 hrs',
    'Your transaction of Rs 1,250 at AMAZON was declined',
    'Payment of Rs 300 to ZOMATO could not be processed',
  ])('%j → failed', (text) => {
    expect(rejection(text)).toBe('failed')
  })

  it('keeps the refund of a failed transaction', () => {
    expect(candidate('Rs 500 for failed UPI txn has been reversed to A/c XX1234').kind).toBe(
      'refund',
    )
  })
})

describe('16. currency and number formatting variations', () => {
  it.each([
    '₹486.00 debited from A/c XX1234 to SWIGGY',
    'Rs486.00 debited from A/c XX1234 to SWIGGY',
    'Rs.486 debited from A/c XX1234 to SWIGGY',
    'Rs. 486.00 debited from A/c XX1234 to SWIGGY',
    'INR 486.00 debited from A/c XX1234 to SWIGGY',
    'INR486 debited from A/c XX1234 to SWIGGY',
    'Rs 486 debited from A/c XX1234 to SWIGGY',
    'Rs ４８６.００ debited from A/c XX1234 to SWIGGY',
  ])('%j → ₹486 to Swiggy', (text) => {
    const c = candidate(text)
    expect(amountOf(c)).toBe('INR 486')
    expect(c.merchant).toBe('Swiggy')
  })

  it('reads Indian digit grouping', () => {
    expect(amountOf(candidate('INR 1,25,000 credited to A/c XX1234'))).toBe('INR 125000')
  })
})

describe('17. capitalisation and whitespace variations', () => {
  const expected = 'INR 486 | expense | Swiggy | food | 1234'
  const summary = (c: TransactionCandidate) =>
    `${amountOf(c)} | ${c.direction} | ${c.merchant} | ${c.category?.categorySlug} | ${c.accountLast4}`

  it.each([
    'Rs.486.00 debited from A/c XX1234 for UPI transaction to SWIGGY',
    'rs.486.00 DEBITED from a/c xx1234 for upi transaction to swiggy',
    'RS.486.00 Debited From A/C XX1234 For UPI Transaction To Swiggy',
    '   Rs.486.00    debited\nfrom   A/c XX1234\tfor UPI transaction   to SWIGGY   ',
    'Rs.486.00 debited from A/c XX1234 for UPI transaction to SWIGGY.',
    'Rs.486.00 debited from A/c XX1234, for UPI transaction to SWIGGY!',
  ])('%j', (text) => {
    expect(summary(candidate(text))).toBe(expected)
  })

  it('gives every spelling the same fingerprint', () => {
    const values = new Set(
      [
        'Rs.486.00 debited from A/c XX1234 to SWIGGY on 03-10-26',
        'rs 486 DEBITED from a/c xx1234 to swiggy on 03-10-2026',
        '  RS. 486.00   debited from A/C XX1234 to Swiggy   on 03-Oct-26 ',
      ].map((text) => candidate(text).fingerprint.value),
    )
    expect(values.size).toBe(1)
  })
})

describe('dates and times', () => {
  it.each([
    ['on 03-10-26', '2026-10-03'],
    ['on 03/10/2026', '2026-10-03'],
    ['on 03.10.26', '2026-10-03'],
    ['on 3-10-26', '2026-10-03'],
    ['on 03Oct26', '2026-10-03'],
    ['on 03-Oct-2026', '2026-10-03'],
    ['on 3 October 2026', '2026-10-03'],
    ['on 2026-10-03', '2026-10-03'],
    ['on 29-02-28', '2028-02-29'],
  ])('%s → %s', (when, date) => {
    const c = candidate(`Rs 500 debited from A/c XX1234 ${when}`)
    expect(iso(c.occurredOn)).toBe(date)
    expect(c.occurredOnSource).toBe('message')
  })

  it('skips an impossible date and reads the next one', () => {
    expect(iso(candidate('Rs 500 debited 2026-13-45 on 2026-10-03 A/c XX1234').occurredOn)).toBe(
      '2026-10-03',
    )
    expect(iso(candidate('Rs 500 debited 31Feb26 on 03Oct26 A/c XX1234').occurredOn)).toBe(
      '2026-10-03',
    )
    expect(iso(candidate('Rs 500 debited 31-02-26 on 03-10-26 A/c XX1234').occurredOn)).toBe(
      '2026-10-03',
    )
  })

  it('reads no date from an impossible one', () => {
    const c = candidate('Rs 500 debited from A/c XX1234 on 30-02-26')
    expect(c.occurredOn).toBeNull()
    expect(c.occurredOnSource).toBeNull()
  })

  it('falls back to the day the message arrived', () => {
    const c = candidate('Rs 500 debited from A/c XX1234', { receivedOn: of(2026, 10, 3) })
    expect(iso(c.occurredOn)).toBe('2026-10-03')
    expect(c.occurredOnSource).toBe('received')
  })

  it("prefers the message's own date to the arrival day", () => {
    const c = candidate('Rs 500 debited from A/c XX1234 on 02-10-26', {
      receivedOn: of(2026, 10, 3),
    })
    expect(iso(c.occurredOn)).toBe('2026-10-02')
  })

  it.each([
    ['at 14:22', '14:22'],
    ['at 14:22:11', '14:22'],
    ['at 9:05', '09:05'],
    ['at 02:30 PM', '14:30'],
    ['at 12:05 am', '00:05'],
    ['at 12:40 p.m.', '12:40'],
  ])('%s → %s', (when, time) => {
    expect(candidate(`Rs 500 debited from A/c XX1234 ${when}`).occurredTime).toBe(time)
  })

  it('reads no time from an impossible one, or from a date', () => {
    expect(candidate('Rs 500 debited from A/c XX1234 at 13:05 PM').occurredTime).toBeNull()
    expect(candidate('Rs 500 debited from A/c XX1234 at 0:05 AM').occurredTime).toBeNull()
    expect(candidate('Rs 500 debited from A/c XX1234 on 03-10-26').occurredTime).toBeNull()
  })
})

describe('references and accounts', () => {
  it.each([
    ['UPI Ref No 427612345678', '427612345678'],
    ['Ref No. 427612345678', '427612345678'],
    ['Refno 427612345678', '427612345678'],
    ['RRN 427612345678', '427612345678'],
    ['UTR: SBIN226123456789', 'SBIN226123456789'],
    ['Txn ID: ab12cd34ef', 'AB12CD34EF'],
  ])('%s → %s', (written, reference) => {
    expect(candidate(`Rs 500 debited from A/c XX1234. ${written}`).reference).toBe(reference)
  })

  it('does not take a word for a reference', () => {
    expect(candidate('Rs 500 debited for UPI transaction to SWIGGY').reference).toBeNull()
  })

  it.each([
    ['A/c XX1234', '1234'],
    ['a/c **1234', '1234'],
    ['A/C no. XXXXXX1234', '1234'],
    ['Acct XX123', '123'],
    ['card ending 1234', '1234'],
    ['Card ending with 1234', '1234'],
    ['account X1234', '1234'],
  ])('%s → %s', (written, last4) => {
    expect(candidate(`Rs 500 debited from ${written}`).accountLast4).toBe(last4)
  })
})

describe('privacy, purity and the ledger boundary', () => {
  const text =
    'Sent Rs.500.00 From HDFC Bank A/C *1234 To SWIGGY On 03/10/26 Ref 427612345678 Not You? Call 18002586161'

  it('returns extracted fields only — the message body is not in the result', () => {
    const serialised = JSON.stringify(candidate(text), (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
    expect(serialised).not.toContain('Not You')
    expect(serialised).not.toContain('18002586161')
    expect(serialised).not.toContain('HDFC Bank')
  })

  it('carries no message text in a rejection either', () => {
    expect(parse('123456 is your OTP for login')).toEqual({ status: 'rejected', reason: 'otp' })
  })

  it('is deterministic', () => {
    expect(candidate(text)).toEqual(candidate(text))
  })

  it('does not modify the rules or categories it is given', () => {
    const rules = Object.freeze(RULES.map((rule) => Object.freeze({ ...rule })))
    const categories = Object.freeze(DEFAULT_CATEGORIES.map((c) => Object.freeze({ ...c })))
    expect(() => parseTransactionMessage({ text, rules, categories })).not.toThrow()
  })

  it('imports nothing outside domain/ — it has no way to reach Supabase or the ledger', () => {
    const sources = readdirSync(HERE).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    )
    expect(sources.length).toBeGreaterThanOrEqual(4)
    for (const file of sources) {
      const code = readFileSync(join(HERE, file), 'utf8')
      for (const [, specifier = ''] of code.matchAll(/from '([^']+)'/g)) {
        const target = resolve(HERE, specifier)
        expect(specifier.startsWith('.'), `${file} imports ${specifier}`).toBe(true)
        expect(target.startsWith(resolve(ROOT, 'src/domain')), `${file} imports ${specifier}`).toBe(
          true,
        )
      }
    }
  })
})

describe('payment-app notifications — the same parser, title and text joined', () => {
  // Invented examples in the shapes payment apps use; Android joins a
  // notification's title and text with ". " (PaymentNotificationListener).
  it.each([
    ['₹486 paid to Swiggy. Paid from HDFC Bank ••1234', 'expense', 'INR 486', 'Swiggy'],
    ['Payment successful. Paid ₹486 to Swiggy', 'expense', 'INR 486', 'Swiggy'],
    ['You paid ₹486.00 to Swiggy', 'expense', 'INR 486', 'Swiggy'],
    ['Your payment of Rs.486.00 to Swiggy is successful', 'expense', 'INR 486', 'Swiggy'],
    ['₹150 sent to Amit Kumar. Paid via UPI', 'expense', 'INR 150', 'Amit Kumar'],
    ['₹500 received from Amit Kumar. Credited to SBI ••1234', 'income', 'INR 500', 'Amit Kumar'],
    ['Amit Kumar paid you ₹500', 'income', 'INR 500', 'Amit Kumar'],
    ['Money received. Amit Kumar paid you ₹500', 'income', 'INR 500', 'Amit Kumar'],
    ['Money received. Received ₹500 from Amit Kumar', 'income', 'INR 500', 'Amit Kumar'],
  ])('%s', (text, kind, amount, merchant) => {
    const found = candidate(text)
    expect(found.kind).toBe(kind)
    expect(amountOf(found)).toBe(amount)
    expect(found.merchant).toBe(merchant)
  })

  it('keeps a reference the notification shows', () => {
    expect(candidate('₹486 paid to Swiggy. UPI Ref No. 412345678901').reference).toContain(
      '412345678901',
    )
  })

  it.each([
    ['Get ₹100 cashback on your next recharge. Pay now!', 'promotional'],
    ['You won a scratch card worth up to ₹50', 'promotional'],
    ['Your electricity bill of ₹486 is due on 10 Oct', 'not_completed'],
    ['Amit Kumar requested ₹500. Tap to pay', 'not_completed'],
    ['Reminder: pay ₹500 to Amit Kumar', 'not_completed'],
    ['Payment of ₹486 to Swiggy failed', 'failed'],
    ['Your wallet balance is ₹1,250', 'balance_only'],
  ])('is not a transaction: %s', (text, reason) => {
    expect(rejection(text)).toBe(reason)
  })

  it('does not take a title for the payer', () => {
    expect(candidate('Money received. Amit Kumar paid you ₹500').merchant).toBe('Amit Kumar')
  })
})
