import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { fromMinor } from '../../money/Money'
import { of } from '../../period/LocalDate'
import type { Transaction } from '../types'

import { confirmationRequestId, findSimilarTransactions, type SimilarityProbe } from './review'

const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const fingerprint = (value: string) => ({ value, basis: 'reference' as const })
const SHA = 'a3f1c2d4e5b60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00'

describe('confirmationRequestId — the exact duplicate key', () => {
  it('is an RFC 9562 version-8 UUID', () => {
    expect(confirmationRequestId(fingerprint(SHA))).toBe('a3f1c2d4-e5b6-8718-a93a-4b5c6d7e8f90')
    expect(confirmationRequestId(fingerprint(SHA))).toMatch(UUID_V8)
  })

  it('is the same for the same fingerprint, and different for a different one', () => {
    expect(confirmationRequestId(fingerprint(SHA))).toBe(confirmationRequestId(fingerprint(SHA)))
    expect(confirmationRequestId(fingerprint(`b${SHA.slice(1)}`))).not.toBe(
      confirmationRequestId(fingerprint(SHA)),
    )
  })

  it('is always a valid UUID that keeps every other bit of the fingerprint', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-f]{64}$/), (hex) => {
        const id = confirmationRequestId(fingerprint(hex))
        expect(id).toMatch(UUID_V8)
        const digits = id.replace(/-/g, '')
        expect(digits.slice(0, 12)).toBe(hex.slice(0, 12))
        expect(digits.slice(13, 16)).toBe(hex.slice(13, 16))
        expect(digits.slice(17)).toBe(hex.slice(17, 32))
      }),
    )
  })

  it('refuses anything that is not a SHA-256 fingerprint', () => {
    expect(() => confirmationRequestId(fingerprint('not-a-hash'))).toThrow(RangeError)
    expect(() => confirmationRequestId(fingerprint(SHA.toUpperCase()))).toThrow(RangeError)
  })
})

function row(overrides: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    kind: 'expense',
    amount: fromMinor(50000n, 'INR'),
    accountId: 'acc-bank',
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

const probe: SimilarityProbe = {
  amount: fromMinor(50000n, 'INR'),
  kind: 'expense',
  occurredOn: of(2026, 10, 3),
  accountId: 'acc-bank',
  merchant: 'Swiggy',
}

describe('findSimilarTransactions — the fuzzy check', () => {
  it('finds the same payment and says why', () => {
    const [match] = findSimilarTransactions(probe, [row({ id: 't1', merchantLabel: 'Swiggy' })])
    expect(match?.transaction.id).toBe('t1')
    expect(match?.reasons).toEqual([
      'same_amount',
      'same_type',
      'same_day',
      'same_account',
      'same_merchant',
    ])
  })

  it('allows one day either side, and no more', () => {
    const found = findSimilarTransactions(probe, [
      row({ id: 'before', occurredOn: of(2026, 10, 2) }),
      row({ id: 'after', occurredOn: of(2026, 10, 4) }),
      row({ id: 'too-early', occurredOn: of(2026, 10, 1) }),
      row({ id: 'too-late', occurredOn: of(2026, 10, 5) }),
    ])
    expect(found.map((match) => match.transaction.id)).toEqual(['after', 'before'])
    expect(found[0]?.reasons).toContain('one_day_apart')
  })

  it.each<[string, Partial<Transaction>]>([
    ['amount', { amount: fromMinor(50001n, 'INR') }],
    ['currency', { amount: fromMinor(50000n, 'USD') }],
    ['type', { kind: 'income' }],
    ['deleted row', { deletedAt: '2026-10-03T11:00:00Z' }],
  ])('ignores a different %s', (_what, change) => {
    expect(findSimilarTransactions(probe, [row({ id: 'x', ...change })])).toEqual([])
  })

  it('matches the merchant in the description, or one name inside the other', () => {
    const reasons = (overrides: Partial<Transaction>, merchant = 'Swiggy') =>
      findSimilarTransactions({ ...probe, merchant }, [row({ id: 'x', ...overrides })])[0]?.reasons
    expect(reasons({ description: 'Swiggy dinner' })).toContain('same_merchant')
    expect(reasons({ merchantLabel: 'Swiggy' }, 'SWIGGY INSTAMART')).toContain('same_merchant')
    expect(reasons({ description: 'Zomato' })).not.toContain('same_merchant')
    expect(reasons({ merchantLabel: null, description: '' })).not.toContain('same_merchant')
  })

  it('names no merchant when the candidate has none', () => {
    const [match] = findSimilarTransactions({ ...probe, merchant: null }, [
      row({ id: 'x', merchantLabel: 'Swiggy' }),
    ])
    expect(match?.reasons).not.toContain('same_merchant')
  })

  it('notes a different account without excluding it', () => {
    const [match] = findSimilarTransactions(probe, [row({ id: 'x', accountId: 'acc-card' })])
    expect(match?.reasons).not.toContain('same_account')
  })

  it('puts the strongest match first: more reasons, then the closer date, then a stable order', () => {
    const found = findSimilarTransactions(probe, [
      row({ id: 'weak', accountId: 'acc-card', occurredOn: of(2026, 10, 2) }),
      row({ id: 'b-same-day', accountId: 'acc-card' }),
      row({ id: 'a-same-day', accountId: 'acc-card' }),
      row({ id: 'strong', merchantLabel: 'Swiggy' }),
      row({ id: 'same-account-next-day', occurredOn: of(2026, 10, 4) }),
    ])
    expect(found.map((match) => match.transaction.id)).toEqual([
      'strong',
      'same-account-next-day',
      'a-same-day',
      'b-same-day',
      'weak',
    ])
  })
})
