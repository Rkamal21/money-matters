import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { format, formatCompact, toSpokenLabel } from './format'
import { fromMinor, MAX_ABS_MINOR } from './Money'
import { parseAmount, PARSE_ERROR_MESSAGES, type ParseErrorCode } from './parse'

const inr = (minor: bigint) => fromMinor(minor, 'INR')

describe('format', () => {
  it('uses Indian digit grouping for en-IN', () => {
    expect(format(inr(12_345_678n))).toBe('₹1,23,456.78')
    expect(format(inr(10_000_000_000n))).toBe('₹10,00,00,000')
  })

  it('shows paise only when there are some, unless asked to always', () => {
    expect(format(inr(87_500n))).toBe('₹875')
    expect(format(inr(87_500n), 'en-IN', { fraction: 'always' })).toBe('₹875.00')
    expect(format(inr(87_505n))).toBe('₹875.05')
  })

  it('prefixes a minus for negatives, including amounts under one rupee', () => {
    expect(format(inr(-12_000n))).toBe('-₹120')
    expect(format(inr(-50n))).toBe('-₹0.50')
  })

  it('prefixes a plus when a signed row asks for one', () => {
    expect(format(inr(6_000_000n), 'en-IN', { sign: 'always' })).toBe('+₹60,000')
    expect(format(inr(0n), 'en-IN', { sign: 'always' })).toBe('₹0')
  })

  it('formats other locales with their own separators', () => {
    expect(format(fromMinor(123_456_789n, 'USD'), 'en-US')).toBe('$1,234,567.89')
    // de-DE separates the symbol with a no-break space; compare the parts that matter.
    const euros = format(fromMinor(123_456n, 'EUR'), 'de-DE')
    expect(euros.startsWith('1.234,56')).toBe(true)
    expect(euros.endsWith('€')).toBe(true)
    expect(format(fromMinor(1234n, 'JPY'), 'ja-JP')).toContain('1,234')
  })

  it('compacts for tight tiles', () => {
    expect(formatCompact(inr(250_000n))).toContain('₹')
    expect(formatCompact(inr(15_000_000n))).toMatch(/L/)
  })
})

describe('toSpokenLabel — what a screen reader hears', () => {
  it.each([
    [0n, 'zero rupees'],
    [100n, 'one rupee'],
    [120_000n, 'one thousand two hundred rupees'],
    [250_050n, 'two thousand five hundred rupees and fifty paise'],
    [
      12_345_678n,
      'one lakh twenty-three thousand four hundred fifty-six rupees and seventy-eight paise',
    ],
    [1_000_000_000n, 'one crore rupees'],
    [-7_500n, 'minus seventy-five rupees'],
  ])('%s paise reads as "%s"', (minor, spoken) => {
    expect(toSpokenLabel(inr(minor))).toBe(spoken)
  })

  it('falls back to the formatted text for other currencies', () => {
    expect(toSpokenLabel(fromMinor(1000n, 'USD'), 'en-US')).toBe('$10')
  })
})

describe('parseAmount — FINANCIAL-ENGINE.md §1.2', () => {
  it.each([
    ['1,234.5', 123_450n],
    ['₹1,234', 123_400n],
    ['Rs. 1,234', 123_400n],
    ['INR 99', 9_900n],
    ['1 234', 123_400n],
    ['12,34,567', 123_456_700n],
    ['.5', 50n],
    ['7.', 700n],
    ['0', 0n],
    ['१२३४.५०', 123_450n],
    ['１２３４', 123_400n],
    ['  42  ', 4_200n],
  ])('accepts %j', (raw, minor) => {
    const result = parseAmount(raw, 'INR')
    expect(result.ok && result.value.minor).toBe(minor)
  })

  it.each<[string, ParseErrorCode]>([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'not_a_number'],
    ['1e5', 'not_a_number'],
    ['1.2.3', 'not_a_number'],
    ['-', 'not_a_number'],
    ['₹', 'not_a_number'],
    ['1234.567', 'too_many_decimals'],
    ['-50', 'negative_not_allowed'],
    ['9000000000000', 'too_large'],
  ])('refuses %j with %s', (raw, code) => {
    const result = parseAmount(raw, 'INR')
    expect(result.ok ? 'ok' : result.error.code).toBe(code)
  })

  it('allows a negative where the caller says so, such as an opening balance', () => {
    const result = parseAmount('-50', 'INR', { allowNegative: true })
    expect(result.ok && result.value.minor).toBe(-5_000n)
  })

  it('respects the currency exponent', () => {
    const yen = parseAmount('1234', 'JPY')
    expect(yen.ok && yen.value.minor).toBe(1234n)
    const bad = parseAmount('12.5', 'JPY')
    expect(bad.ok ? 'ok' : bad.error.code).toBe('too_many_decimals')
  })

  it('has a message for every error code', () => {
    for (const message of Object.values(PARSE_ERROR_MESSAGES))
      expect(message.length).toBeGreaterThan(5)
  })

  it('property: parseAmount(format(m)) === m for every non-negative amount', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_ABS_MINOR - 1n }), (minor) => {
        const result = parseAmount(format(inr(minor)), 'INR')
        return result.ok && result.value.minor === minor
      }),
      { seed: 3, numRuns: 500 },
    )
  })
})
