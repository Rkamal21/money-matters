import { describe, expect, it } from 'vitest'

import { fromMinor, type Money } from '../money/Money'

import { aggregateByCategory } from './aggregateByCategory'
import {
  type CategoryRule,
  learnedRule,
  matchRules,
  orderRules,
  RuleBasedProvider,
  ruleMatches,
} from './categorize/CategoryRule'
import { normalizeMerchant } from './categorize/normalizeMerchant'
import { emptySummary, netSpending, type CategoryTotal } from './PeriodSummary'
import { categoryKindFor, directionOf, isLiability } from './types'

const inr = (minor: bigint): Money => fromMinor(minor, 'INR')

describe('normalizeMerchant — real Indian merchant strings', () => {
  it.each([
    ['UPI/SWIGGY/423512/PAYTM', 'swiggy paytm'],
    ['AMAZON PAY INDIA PRI', 'amazon pay india pri'],
    ['UBER   INDIA SYSTEMS', 'uber india systems'],
    ['POS 1234 BIGBASKET BLR', 'bigbasket blr'],
    ['swiggy.upi@axisbank', 'swiggy'],
    ['zomato@icici', 'zomato'],
    ['NEFT-REF-99887766-Salary Sept', 'salary sept'],
    ['Tata 1mg', 'tata 1mg'],
    ['', ''],
  ])('%j → %j', (raw, normalised) => {
    expect(normalizeMerchant(raw)).toBe(normalised)
  })
})

function rule(
  overrides: Partial<CategoryRule> & Pick<CategoryRule, 'pattern' | 'categorySlug'>,
): CategoryRule {
  return {
    id: `${overrides.userId ?? 'sys'}:${overrides.pattern}`,
    userId: null,
    matchType: 'contains',
    merchantLabel: overrides.pattern,
    confidence: 0.95,
    priority: 100,
    isEnabled: true,
    ...overrides,
  }
}

const SYSTEM: CategoryRule[] = [
  rule({ pattern: 'swiggy', merchantLabel: 'Swiggy', categorySlug: 'food' }),
  rule({ pattern: 'amazon', merchantLabel: 'Amazon', categorySlug: 'shopping', confidence: 0.9 }),
  rule({ pattern: 'uber', merchantLabel: 'Uber', categorySlug: 'transport' }),
  rule({ pattern: 'ola', matchType: 'exact', merchantLabel: 'Ola', categorySlug: 'transport' }),
  rule({ pattern: 'instamart', merchantLabel: 'Swiggy Instamart', categorySlug: 'food' }),
  rule({ pattern: 'air india', merchantLabel: 'Air India', categorySlug: 'travel' }),
  rule({
    pattern: 'netflix',
    merchantLabel: 'Netflix',
    categorySlug: 'entertainment',
    isEnabled: false,
  }),
]

describe('matchRules', () => {
  it('typing "swiggy" suggests Food with visible confidence', () => {
    expect(matchRules(SYSTEM, 'swiggy')).toMatchObject({
      categorySlug: 'food',
      merchantLabel: 'Swiggy',
      confidence: 0.95,
      source: 'system',
    })
  })

  it('matches through bank noise', () => {
    expect(matchRules(SYSTEM, 'UPI/SWIGGY/423512/PAYTM')?.categorySlug).toBe('food')
    expect(matchRules(SYSTEM, 'AMAZON PAY INDIA PRI')?.categorySlug).toBe('shopping')
    expect(matchRules(SYSTEM, 'AIR INDIA AI-502')?.categorySlug).toBe('travel')
  })

  it('treats exact as a whole word: "ola" matches Ola, not granola', () => {
    expect(matchRules(SYSTEM, 'UPI/OLA/5566')?.categorySlug).toBe('transport')
    expect(matchRules(SYSTEM, 'granola bar')).toBeNull()
    expect(ruleMatches({ pattern: 'ola', matchType: 'exact' }, 'ola')).toBe(true)
  })

  it('supports prefix rules', () => {
    expect(ruleMatches({ pattern: 'amz', matchType: 'prefix' }, 'amz mktp')).toBe(true)
    expect(ruleMatches({ pattern: 'amz', matchType: 'prefix' }, 'the amz')).toBe(false)
  })

  it('returns null when nothing matches — never a guessed "Other"', () => {
    expect(matchRules(SYSTEM, 'Sharma General Store')).toBeNull()
    expect(matchRules(SYSTEM, '   ')).toBeNull()
  })

  it('skips disabled rules', () => {
    expect(matchRules(SYSTEM, 'netflix')).toBeNull()
  })

  it('a user rule beats a system rule', () => {
    const mine = rule({ userId: 'u1', pattern: 'swiggy', categorySlug: 'personal', priority: 10 })
    expect(matchRules([...SYSTEM, mine], 'swiggy dinner')).toMatchObject({
      categorySlug: 'personal',
      source: 'user',
    })
  })

  it('at equal priority the more specific rule wins', () => {
    // "swiggy instamart" contains both "swiggy" and "instamart"; the longer pattern wins.
    expect(matchRules(SYSTEM, 'swiggy instamart order')?.merchantLabel).toBe('Swiggy Instamart')
    const ordered = orderRules([
      rule({ pattern: 'ola', categorySlug: 'a' }),
      rule({ pattern: 'ola', matchType: 'exact', categorySlug: 'b' }),
    ])
    expect(ordered[0]?.matchType).toBe('exact')
  })
})

describe('RuleBasedProvider', () => {
  it('suggests from the merchant, then falls back to the description', async () => {
    const provider = new RuleBasedProvider(SYSTEM)
    expect((await provider.suggest({ merchantRaw: 'uber trip' }))?.categorySlug).toBe('transport')
    expect(
      (await provider.suggest({ merchantRaw: 'card 4412', description: 'swiggy dinner' }))
        ?.categorySlug,
    ).toBe('food')
    expect(await provider.suggest({ merchantRaw: 'nothing here' })).toBeNull()
  })
})

describe('learning from a correction', () => {
  it('writes a personal rule on the pattern that produced the wrong suggestion', () => {
    const suggestion = matchRules(SYSTEM, 'swiggy')
    if (suggestion === null) throw new Error('expected a suggestion')
    expect(learnedRule({ suggestion, correctedSlug: 'personal' })).toEqual({
      pattern: 'swiggy',
      matchType: 'contains',
      merchantLabel: 'Swiggy',
      categorySlug: 'personal',
      confidence: 0.95,
      priority: 10,
    })
  })

  it('learns nothing when the suggestion was accepted', () => {
    const suggestion = matchRules(SYSTEM, 'swiggy')
    if (suggestion === null) throw new Error('expected a suggestion')
    expect(learnedRule({ suggestion, correctedSlug: 'food' })).toBeNull()
  })
})

describe('aggregateByCategory', () => {
  const total = (
    id: string,
    expense: bigint,
    refund = 0n,
    extra: Partial<CategoryTotal> = {},
  ): CategoryTotal => ({
    categoryId: id,
    slug: id,
    name: id,
    kind: 'expense',
    treatment: 'variable',
    icon: 'circle',
    color: 'neutral',
    expense: inr(expense),
    refund: inr(refund),
    income: inr(0n),
    transactionCount: 1,
    ...extra,
  })

  it('nets refunds, drops empties and excluded spending, and sorts largest first', () => {
    const { total: sum, slices } = aggregateByCategory({
      currency: 'INR',
      totals: [
        total('food', 300n),
        total('shopping', 900n, 100n),
        total('returned', 100n, 100n),
        total('work', 500n, 0n, { treatment: 'excluded' }),
        total('salary', 0n, 0n, { kind: 'income', income: inr(1000n) }),
      ],
    })
    expect(sum.minor).toBe(1100n)
    expect(slices.map((slice) => [slice.categoryId, slice.net.minor])).toEqual([
      ['shopping', 800n],
      ['food', 300n],
    ])
    expect(slices[0]?.share).toBeCloseTo(800 / 1100)
  })

  it('folds the tail into one slice beyond `top`', () => {
    const { slices } = aggregateByCategory({
      currency: 'INR',
      top: 2,
      totals: [total('a', 500n), total('b', 400n), total('c', 300n), total('d', 200n)],
    })
    expect(slices.map((slice) => slice.name)).toEqual(['a', 'b', 'Everything else'])
    expect(slices[2]?.net.minor).toBe(500n)
  })
})

describe('entity helpers', () => {
  it('files each kind under the right category kind', () => {
    expect(categoryKindFor('income')).toBe('income')
    expect(categoryKindFor('expense')).toBe('expense')
    expect(categoryKindFor('refund')).toBe('expense')
    expect(categoryKindFor('transfer')).toBeNull()
  })

  it('a transfer is neither in nor out for the user, and both for the accounts', () => {
    const transfer = { kind: 'transfer' as const, accountId: 'bank', counterAccountId: 'savings' }
    expect(directionOf(transfer)).toBe('neutral')
    expect(directionOf(transfer, 'bank')).toBe('out')
    expect(directionOf(transfer, 'savings')).toBe('in')
    expect(directionOf(transfer, 'other')).toBe('neutral')
    expect(directionOf({ kind: 'refund', accountId: 'a', counterAccountId: null })).toBe('in')
    expect(directionOf({ kind: 'expense', accountId: 'a', counterAccountId: null })).toBe('out')
  })

  it('only a credit card is a liability', () => {
    expect(isLiability('credit_card')).toBe(true)
    expect(isLiability('wallet')).toBe(false)
  })

  it('net spending leaves out excluded categories and nets refunds per group', () => {
    const summary = {
      ...emptySummary('INR'),
      fixed: inr(1000n),
      fixedRefund: inr(2000n),
      variable: inr(500n),
      variableRefund: inr(100n),
      excluded: inr(999n),
    }
    expect(netSpending(summary).minor).toBe(400n)
  })
})
