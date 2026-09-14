/**
 * Money — an exact amount in minor units, carried with its currency.
 *
 * ADR-0005 and FINANCIAL-ENGINE.md §1.1. The rules the type enforces rather
 * than documents:
 *
 *   - `number` cannot enter. The only constructors take a `bigint` or a wire
 *     integer that is checked with `Number.isSafeInteger` first.
 *   - Mixing currencies throws. It is a programmer error, not a user error.
 *   - Division always returns its remainder, so discarding leftover paise is a
 *     visible choice rather than an accident.
 *   - `allocate` never loses or invents a paisa.
 *
 * Money has no operators, so `income - fixed` does not compile. Arithmetic is
 * these functions, and these functions live in `domain/`.
 */

declare const moneyBrand: unique symbol

/** ISO 4217 code, upper case. One per user at MVP (ARCHITECTURE.md A2). */
export type CurrencyCode = string

export interface Money {
  readonly minor: bigint
  readonly currency: CurrencyCode
  readonly [moneyBrand]: 'Money'
}

/** ±9 × 10^14 minor units: every value stays inside Number.MAX_SAFE_INTEGER on the wire. */
export const MAX_ABS_MINOR = 900_000_000_000_000n

const EXPONENTS: Readonly<Record<string, number>> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  SGD: 2,
  JPY: 0,
}

const CURRENCY_CODE = /^[A-Z]{3}$/

export class CurrencyMismatchError extends Error {
  override readonly name = 'CurrencyMismatchError'

  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Cannot combine ${a} with ${b}: amounts in different currencies never mix.`)
  }
}

export class MoneyRangeError extends Error {
  override readonly name = 'MoneyRangeError'
}

/** Decimal places for a currency. Unknown codes default to 2. */
export function currencyExponent(currency: CurrencyCode): number {
  return EXPONENTS[currency] ?? 2
}

/** 100n for INR: the number of minor units in one major unit. */
export function minorPerMajor(currency: CurrencyCode): bigint {
  return 10n ** BigInt(currencyExponent(currency))
}

function make(minor: bigint, currency: CurrencyCode): Money {
  return Object.freeze({ minor, currency }) as Money
}

export function fromMinor(minor: bigint, currency: CurrencyCode): Money {
  if (!CURRENCY_CODE.test(currency)) {
    throw new TypeError(`"${currency}" is not an ISO 4217 currency code.`)
  }
  return make(minor, currency)
}

/**
 * The repository layer's only way in. PostgREST serialises `bigint` columns as
 * JSON numbers; anything that is not a safe integer is refused rather than
 * silently truncated (ARCHITECTURE.md R4).
 */
export function fromWire(value: unknown, currency: CurrencyCode): Money {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return fromMinor(BigInt(value), currency)
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyRangeError('Expected a whole number of minor units.')
  }
  return fromMinor(BigInt(value), currency)
}

/** The repository layer's only way out. */
export function toWire(money: Money): number {
  const value = Number(money.minor)
  if (!Number.isSafeInteger(value)) {
    throw new MoneyRangeError('Amount is outside the range that can be sent safely.')
  }
  return value
}

export function zero(currency: CurrencyCode): Money {
  return fromMinor(0n, currency)
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return make(a.minor + b.minor, a.currency)
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return make(a.minor - b.minor, a.currency)
}

export function negate(a: Money): Money {
  return make(-a.minor, a.currency)
}

export function abs(a: Money): Money {
  return a.minor < 0n ? negate(a) : a
}

/** Mathematical floor division: rounds toward −∞, so the remainder is never negative. */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return -floorDiv(-a, b)
}

function assertPositiveDivisor(divisor: bigint): void {
  if (divisor <= 0n) throw new RangeError('Divisor must be a positive whole number.')
}

/**
 * `a × numerator / denominator`, rounded down — "30% of a budget" is
 * `multiplyByRatio(budget, 30n, 100n)`. Rounding down keeps derived
 * allowances conservative (FINANCIAL-ENGINE.md §1.3).
 */
export function multiplyByRatio(a: Money, numerator: bigint, denominator: bigint): Money {
  assertPositiveDivisor(denominator)
  return make(floorDiv(a.minor * numerator, denominator), a.currency)
}

/**
 * Split `a` into `divisor` equal parts, rounding down, and hand back what is
 * left over: `quotient × divisor + remainder = a`, exactly, always.
 */
export function divideFloor(a: Money, divisor: bigint): { quotient: Money; remainder: Money } {
  assertPositiveDivisor(divisor)
  const quotient = floorDiv(a.minor, divisor)
  return {
    quotient: make(quotient, a.currency),
    remainder: make(a.minor - quotient * divisor, a.currency),
  }
}

/** Rounded up. For amounts the user must reach — a goal's required saving — never down. */
export function divideCeil(a: Money, divisor: bigint): Money {
  assertPositiveDivisor(divisor)
  return make(ceilDiv(a.minor, divisor), a.currency)
}

/**
 * Distribute `a` by `weights` with the largest-remainder method: every part
 * is rounded down, then the leftover minor units go one each to the parts
 * with the largest fractional remainders. The result sums to `a` exactly.
 *
 *   allocate(₹100, [1n, 1n, 1n]) → ₹33.34, ₹33.33, ₹33.33
 */
export function allocate(a: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight.')
  if (weights.some((weight) => weight < 0n)) throw new RangeError('Weights cannot be negative.')
  const total = weights.reduce((sum, weight) => sum + weight, 0n)
  if (total === 0n) throw new RangeError('Weights must not all be zero.')

  if (a.minor < 0n) return allocate(negate(a), weights).map(negate)

  const parts = weights.map((weight) => (a.minor * weight) / total)
  const remainders = weights.map((weight, index) => ({
    index,
    fraction: (a.minor * weight) % total,
  }))

  let leftover = a.minor - parts.reduce((sum, part) => sum + part, 0n)
  remainders.sort((x, y) =>
    x.fraction === y.fraction ? x.index - y.index : x.fraction > y.fraction ? -1 : 1,
  )
  for (const { index } of remainders) {
    if (leftover === 0n) break
    parts[index] = (parts[index] ?? 0n) + 1n
    leftover -= 1n
  }

  return parts.map((part) => make(part, a.currency))
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b)
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor
}

export function isZero(a: Money): boolean {
  return a.minor === 0n
}

export function isNegative(a: Money): boolean {
  return a.minor < 0n
}

export function isPositive(a: Money): boolean {
  return a.minor > 0n
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b
}

export function sumAll(list: readonly Money[], currency: CurrencyCode): Money {
  return list.reduce((sum, item) => add(sum, item), zero(currency))
}

/**
 * `numerator / denominator` as a plain number, for progress bars and
 * percentages. Display only: never fed back into money arithmetic
 * (FINANCIAL-ENGINE.md §1.3). `null` when the denominator is zero, so a
 * caller cannot render `NaN` or `Infinity` by accident.
 */
export function ratio(numerator: Money, denominator: Money): number | null {
  assertSameCurrency(numerator, denominator)
  if (denominator.minor === 0n) return null
  return Number(numerator.minor) / Number(denominator.minor)
}

/**
 * An approximate number of major units, for scaling a chart axis and nothing
 * else. It is the one sanctioned way an amount becomes a float, and the result
 * must never be fed back into money arithmetic (FINANCIAL-ENGINE.md §1.3).
 */
export function toChartValue(a: Money): number {
  return Number(a.minor) / 10 ** currencyExponent(a.currency)
}

/** Plain decimal text, for pre-filling an input: 250050n → "2500.50", 250000n → "2500". */
export function toMajorString(a: Money): string {
  const exponent = currencyExponent(a.currency)
  const negative = a.minor < 0n
  const magnitude = negative ? -a.minor : a.minor
  const unit = 10n ** BigInt(exponent)
  const major = (magnitude / unit).toString()
  const fraction = magnitude % unit
  const sign = negative ? '-' : ''
  if (fraction === 0n || exponent === 0) return `${sign}${major}`
  return `${sign}${major}.${fraction.toString().padStart(exponent, '0')}`
}

/** The value object's methods under one name: `Money.add(a, b)`. */
export const Money = {
  fromMinor,
  fromWire,
  toWire,
  zero,
  add,
  subtract,
  negate,
  abs,
  multiplyByRatio,
  divideFloor,
  divideCeil,
  allocate,
  compare,
  equals,
  isZero,
  isNegative,
  isPositive,
  max,
  min,
  sumAll,
  ratio,
  toMajorString,
} as const
