import { createHash } from 'node:crypto'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { fromMinor, type Money } from '../../money/Money'
import { of } from '../../period/LocalDate'

import { type FingerprintInput, fingerprintKey, fingerprintOf } from './fingerprint'
import { sha256Hex } from './sha256'

const inr = (minor: bigint): Money => fromMinor(minor, 'INR')

const base: FingerprintInput = {
  amount: inr(48600n),
  direction: 'expense',
  reference: null,
  occurredOn: of(2026, 10, 3),
  merchantRaw: 'SWIGGY',
  accountLast4: '1234',
}

describe('sha256Hex — FIPS 180-4 test vectors', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      // 112 bytes: the padding spills into a third block.
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ])('sha256(%j)', (input, digest) => {
    expect(sha256Hex(input)).toBe(digest)
  })

  it('hashes a million bytes', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })

  it('hashes the UTF-8 bytes, so ₹ and Devanagari match a reference implementation', () => {
    for (const text of ['₹486', 'रुपये ५००', 'café', '🙂']) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
    }
  })

  it('agrees with node:crypto on arbitrary strings, across every block boundary', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
        expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
      }),
      { numRuns: 300 },
    )
  })
})

describe('fingerprintKey — the canonical, versioned key', () => {
  it('uses the reference when there is one, with direction and amount', () => {
    expect(fingerprintKey({ ...base, reference: '427612345678' })).toBe(
      'v1|ref|427612345678|expense|INR:48600',
    )
  })

  it('upper-cases the reference, so a CSV row and an SMS agree', () => {
    expect(fingerprintKey({ ...base, reference: 'axn12ab3456' })).toBe(
      fingerprintKey({ ...base, reference: 'AXN12AB3456' }),
    )
  })

  it('falls back to amount, direction, date, normalised merchant and account', () => {
    expect(fingerprintKey(base)).toBe('v1|fields|expense|INR:48600|2026-10-03|swiggy|1234')
  })

  it('marks every missing field rather than dropping it, so positions never shift', () => {
    expect(
      fingerprintKey({ ...base, occurredOn: null, merchantRaw: null, accountLast4: null }),
    ).toBe('v1|fields|expense|INR:48600|-|-|-')
  })

  it('treats a merchant that normalises to nothing as missing', () => {
    expect(fingerprintKey({ ...base, merchantRaw: 'UPI 4276123' })).toBe(
      'v1|fields|expense|INR:48600|2026-10-03|-|1234',
    )
  })
})

describe('fingerprintOf — duplicate detection', () => {
  it('is a 64-character lower-case SHA-256 of the key', () => {
    const fingerprint = fingerprintOf(base)
    expect(fingerprint.value).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint.value).toBe(sha256Hex(fingerprintKey(base)))
  })

  it('names its basis', () => {
    expect(fingerprintOf({ ...base, reference: '427612345678' }).basis).toBe('reference')
    expect(fingerprintOf(base).basis).toBe('fields')
    expect(fingerprintOf({ ...base, occurredOn: null }).basis).toBe('fields_undated')
  })

  it('is deterministic', () => {
    expect(fingerprintOf(base)).toEqual(fingerprintOf({ ...base }))
  })

  it('matches the same payee written two ways — normalised text, not raw', () => {
    expect(fingerprintOf({ ...base, merchantRaw: 'swiggy.upi@axisbank' }).value).toBe(
      fingerprintOf(base).value,
    )
    expect(fingerprintOf({ ...base, merchantRaw: 'UPI/SWIGGY/4276' }).value).toBe(
      fingerprintOf(base).value,
    )
  })

  it.each<[string, Partial<FingerprintInput>]>([
    ['amount', { amount: inr(48601n) }],
    ['currency', { amount: fromMinor(48600n, 'USD') }],
    ['direction', { direction: 'income' }],
    ['date', { occurredOn: of(2026, 10, 4) }],
    ['merchant', { merchantRaw: 'ZOMATO' }],
    ['account', { accountLast4: '9876' }],
  ])('changes when the %s changes', (_field, change) => {
    expect(fingerprintOf({ ...base, ...change }).value).not.toBe(fingerprintOf(base).value)
  })

  it('keeps a refund apart from the payment it reverses, even with the same reference', () => {
    const paid = fingerprintOf({ ...base, reference: '427612345678' })
    const refunded = fingerprintOf({ ...base, reference: '427612345678', direction: 'income' })
    expect(refunded.value).not.toBe(paid.value)
  })

  it('ignores the merchant, date and account once a reference is known', () => {
    const withReference = { ...base, reference: '427612345678' }
    expect(
      fingerprintOf({
        ...withReference,
        merchantRaw: 'Other',
        occurredOn: null,
        accountLast4: null,
      }).value,
    ).toBe(fingerprintOf(withReference).value)
  })
})
