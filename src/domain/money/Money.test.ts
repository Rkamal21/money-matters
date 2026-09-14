import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  add,
  allocate,
  compare,
  CurrencyMismatchError,
  divideCeil,
  divideFloor,
  fromMinor,
  fromWire,
  isNegative,
  isPositive,
  isZero,
  MAX_ABS_MINOR,
  max,
  min,
  MoneyRangeError,
  multiplyByRatio,
  negate,
  ratio,
  subtract,
  sumAll,
  toMajorString,
  toWire,
  zero,
} from './Money'

const inr = (minor: bigint) => fromMinor(minor, 'INR')

/** Any amount inside the range the database accepts. */
const anyMinor = fc.bigInt({ min: -(MAX_ABS_MINOR - 1n), max: MAX_ABS_MINOR - 1n })

describe('construction', () => {
  it('refuses a currency code that is not ISO 4217-shaped', () => {
    expect(() => fromMinor(1n, 'inr')).toThrow(TypeError)
    expect(() => fromMinor(1n, 'RUPEE')).toThrow(TypeError)
  })

  it('reads a wire integer, and refuses anything that is not a safe integer', () => {
    expect(fromWire(250000, 'INR').minor).toBe(250000n)
    expect(fromWire('-120', 'INR').minor).toBe(-120n)
    expect(() => fromWire(12.5, 'INR')).toThrow(MoneyRangeError)
    expect(() => fromWire(2 ** 60, 'INR')).toThrow(MoneyRangeError)
    expect(() => fromWire('12.5', 'INR')).toThrow(MoneyRangeError)
    expect(() => fromWire(null, 'INR')).toThrow(MoneyRangeError)
  })

  it('writes a wire integer, and refuses one that would lose precision', () => {
    expect(toWire(inr(250000n))).toBe(250000)
    expect(() => toWire(inr(2n ** 60n))).toThrow(MoneyRangeError)
  })

  it('freezes values, so an amount cannot be edited in place', () => {
    expect(Object.isFrozen(inr(1n))).toBe(true)
  })
})

describe('arithmetic', () => {
  it('adds, subtracts and negates exactly', () => {
    expect(add(inr(10n), inr(20n)).minor).toBe(30n)
    expect(subtract(inr(10n), inr(25n)).minor).toBe(-15n)
    expect(negate(inr(7n)).minor).toBe(-7n)
  })

  it('throws when currencies are mixed — a programmer error, not a user error', () => {
    expect(() => add(inr(1n), fromMinor(1n, 'USD'))).toThrow(CurrencyMismatchError)
    expect(() => compare(inr(1n), fromMinor(1n, 'USD'))).toThrow(CurrencyMismatchError)
  })

  it('multiplies by a ratio, rounding down', () => {
    expect(multiplyByRatio(inr(1000n), 30n, 100n).minor).toBe(300n)
    expect(multiplyByRatio(inr(1001n), 1n, 3n).minor).toBe(333n)
    expect(multiplyByRatio(inr(-1001n), 1n, 3n).minor).toBe(-334n)
    expect(() => multiplyByRatio(inr(1n), 1n, 0n)).toThrow(RangeError)
  })

  it('divides with a visible remainder: ₹17,500 over 20 days is ₹875 with nothing left', () => {
    const { quotient, remainder } = divideFloor(inr(1_750_000n), 20n)
    expect(quotient.minor).toBe(87_500n)
    expect(remainder.minor).toBe(0n)
  })

  it('keeps the leftover paisa as the remainder rather than dropping it', () => {
    const { quotient, remainder } = divideFloor(inr(1_200_001n), 20n)
    expect(quotient.minor).toBe(60_000n)
    expect(remainder.minor).toBe(1n)
  })

  it('floors toward minus infinity, so the remainder is never negative', () => {
    const { quotient, remainder } = divideFloor(inr(-7n), 2n)
    expect(quotient.minor).toBe(-4n)
    expect(remainder.minor).toBe(1n)
  })

  it('rounds up when asked to, for amounts a user must reach', () => {
    expect(divideCeil(inr(10n), 3n).minor).toBe(4n)
    expect(divideCeil(inr(9n), 3n).minor).toBe(3n)
    expect(divideCeil(inr(-10n), 3n).minor).toBe(-3n)
    expect(() => divideCeil(inr(1n), 0n)).toThrow(RangeError)
  })

  it('refuses a non-positive divisor', () => {
    expect(() => divideFloor(inr(10n), 0n)).toThrow(RangeError)
    expect(() => divideFloor(inr(10n), -2n)).toThrow(RangeError)
  })

  it('compares, and picks max and min', () => {
    expect(compare(inr(1n), inr(2n))).toBe(-1)
    expect(compare(inr(2n), inr(2n))).toBe(0)
    expect(compare(inr(3n), inr(2n))).toBe(1)
    expect(max(inr(1n), inr(2n)).minor).toBe(2n)
    expect(min(inr(1n), inr(2n)).minor).toBe(1n)
  })

  it('answers the sign questions', () => {
    expect(isZero(zero('INR'))).toBe(true)
    expect(isNegative(inr(-1n))).toBe(true)
    expect(isPositive(inr(1n))).toBe(true)
    expect(isPositive(inr(0n))).toBe(false)
  })

  it('sums a list, including the empty one', () => {
    expect(sumAll([inr(1n), inr(2n), inr(3n)], 'INR').minor).toBe(6n)
    expect(sumAll([], 'INR').minor).toBe(0n)
  })

  it('gives a display ratio, and null rather than Infinity for a zero denominator', () => {
    expect(ratio(inr(25n), inr(100n))).toBe(0.25)
    expect(ratio(inr(25n), inr(0n))).toBeNull()
  })

  it('renders plain decimal text for an input', () => {
    expect(toMajorString(inr(250050n))).toBe('2500.50')
    expect(toMajorString(inr(250000n))).toBe('2500')
    expect(toMajorString(inr(5n))).toBe('0.05')
    expect(toMajorString(inr(-120n))).toBe('-1.20')
    expect(toMajorString(fromMinor(500n, 'JPY'))).toBe('500')
  })
})

describe('allocate — never loses or invents a paisa', () => {
  it('splits ₹100 three ways as 3334 + 3333 + 3333', () => {
    expect(allocate(inr(10_000n), [1n, 1n, 1n]).map((part) => part.minor)).toEqual([
      3334n,
      3333n,
      3333n,
    ])
  })

  it('honours weights', () => {
    expect(allocate(inr(1000n), [3n, 1n]).map((part) => part.minor)).toEqual([750n, 250n])
  })

  it('allocates negative amounts symmetrically', () => {
    expect(allocate(inr(-10n), [1n, 1n, 1n]).map((part) => part.minor)).toEqual([-4n, -3n, -3n])
  })

  it('refuses nonsense weights', () => {
    expect(() => allocate(inr(10n), [])).toThrow(RangeError)
    expect(() => allocate(inr(10n), [0n, 0n])).toThrow(RangeError)
    expect(() => allocate(inr(10n), [1n, -1n])).toThrow(RangeError)
  })

  it('property: the parts always sum to the whole', () => {
    fc.assert(
      fc.property(
        anyMinor,
        fc.array(fc.bigInt({ min: 0n, max: 1000n }), { minLength: 1, maxLength: 8 }),
        (minor, weights) => {
          fc.pre(weights.some((weight) => weight > 0n))
          const parts = allocate(inr(minor), weights)
          return parts.reduce((sum, part) => sum + part.minor, 0n) === minor
        },
      ),
      { seed: 20260914, numRuns: 500 },
    )
  })
})

describe('properties', () => {
  it('add and subtract are inverses', () => {
    fc.assert(
      fc.property(anyMinor, anyMinor, (a, b) => subtract(add(inr(a), inr(b)), inr(b)).minor === a),
      { seed: 1, numRuns: 500 },
    )
  })

  it('divideFloor: quotient × n + remainder = amount, with 0 ≤ remainder < n', () => {
    fc.assert(
      fc.property(anyMinor, fc.bigInt({ min: 1n, max: 400n }), (minor, n) => {
        const { quotient, remainder } = divideFloor(inr(minor), n)
        return (
          quotient.minor * n + remainder.minor === minor &&
          remainder.minor >= 0n &&
          remainder.minor < n
        )
      }),
      { seed: 2, numRuns: 500 },
    )
  })

  it('is exact at the edge of the range, where a float would not be', () => {
    const big = inr(MAX_ABS_MINOR - 1n)
    expect(subtract(add(big, inr(1n)), inr(1n)).minor).toBe(MAX_ABS_MINOR - 1n)
  })
})
