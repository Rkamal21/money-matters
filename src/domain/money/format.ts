import { currencyExponent, type Money } from './Money'

/**
 * Formatting — FINANCIAL-ENGINE.md §1.1 "output".
 *
 * The integer part goes through `Intl.NumberFormat` as a `bigint`, which is
 * exact and gives the locale's grouping (`en-IN` → ₹12,34,567). The fraction
 * is appended from the minor units directly. At no point does an amount pass
 * through a floating-point number.
 */

export interface FormatOptions {
  /** `auto`: show paise only when there are some. `always`: ₹875.00. */
  readonly fraction?: 'auto' | 'always'
  /** `always` prefixes a `+` on positive amounts, for signed ledger rows. */
  readonly sign?: 'auto' | 'always'
}

const decimalSeparators = new Map<string, string>()

function decimalSeparator(locale: string): string {
  let separator = decimalSeparators.get(locale)
  if (separator === undefined) {
    separator =
      new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
        ?.value ?? '.'
    decimalSeparators.set(locale, separator)
  }
  return separator
}

const integerFormats = new Map<string, Intl.NumberFormat>()

function integerFormat(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`
  let formatter = integerFormats.get(key)
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
    integerFormats.set(key, formatter)
  }
  return formatter
}

/** "₹2,500.50", "₹875", "-₹120", "+₹60,000". */
export function format(money: Money, locale = 'en-IN', options: FormatOptions = {}): string {
  const exponent = currencyExponent(money.currency)
  const unit = 10n ** BigInt(exponent)
  const negative = money.minor < 0n
  const magnitude = negative ? -money.minor : money.minor
  const major = magnitude / unit
  const fraction = magnitude % unit

  const parts = integerFormat(locale, money.currency).formatToParts(major)
  const showFraction =
    exponent > 0 && (fraction !== 0n || (options.fraction ?? 'auto') === 'always')

  let text = ''
  let lastInteger = -1
  parts.forEach((part, index) => {
    if (part.type === 'integer') lastInteger = index
  })
  parts.forEach((part, index) => {
    text += part.value
    if (index === lastInteger && showFraction) {
      text += decimalSeparator(locale) + fraction.toString().padStart(exponent, '0')
    }
  })

  if (negative) return `-${text}`
  if ((options.sign ?? 'auto') === 'always' && money.minor > 0n) return `+${text}`
  return text
}

/**
 * "₹2.5K", "₹1.2L" — charts and tight tiles only. Approximate by design, which
 * is why it is the one place an amount becomes a float: to be rounded for
 * display, never to be computed with.
 */
export function formatCompact(money: Money, locale = 'en-IN'): string {
  const exponent = currencyExponent(money.currency)
  const approximate = Number(money.minor) / 10 ** exponent
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(approximate)
}

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const

const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? ''
  const tens = TENS[Math.floor(n / 10)] ?? ''
  const ones = n % 10
  return ones === 0 ? tens : `${tens}-${ONES[ones] ?? ''}`
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds === 0) return belowHundred(rest)
  const head = `${ONES[hundreds] ?? ''} hundred`
  return rest === 0 ? head : `${head} ${belowHundred(rest)}`
}

/** Indian naming: crore, lakh, thousand, hundred. */
function indianWords(value: bigint): string {
  if (value === 0n) return 'zero'
  const words: string[] = []
  let rest = value

  const crores = rest / 10_000_000n
  rest %= 10_000_000n
  if (crores > 0n) words.push(`${indianWords(crores)} crore`)

  const lakhs = Number(rest / 100_000n)
  rest %= 100_000n
  if (lakhs > 0) words.push(`${belowHundred(lakhs)} lakh`)

  const thousands = Number(rest / 1000n)
  rest %= 1000n
  if (thousands > 0) words.push(`${belowHundred(thousands)} thousand`)

  const remainder = Number(rest)
  if (remainder > 0) words.push(belowThousand(remainder))

  return words.join(' ')
}

/**
 * The amount as words, for an `aria-label`: "two thousand five hundred
 * rupees and fifty paise" rather than "rupee-sign two comma five hundred"
 * (ARCHITECTURE.md §F.6). Rupees only; any other currency falls back to the
 * formatted text, which screen readers already voice sensibly.
 */
export function toSpokenLabel(money: Money, locale = 'en-IN'): string {
  if (money.currency !== 'INR') return format(money, locale)

  const negative = money.minor < 0n
  const magnitude = negative ? -money.minor : money.minor
  const rupees = magnitude / 100n
  const paise = Number(magnitude % 100n)

  let text = `${indianWords(rupees)} ${rupees === 1n ? 'rupee' : 'rupees'}`
  if (paise > 0) text += ` and ${belowHundred(paise)} paise`
  return negative ? `minus ${text}` : text
}
