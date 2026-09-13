import { type Result, err, ok } from '../errors/AppError'

import { type CurrencyCode, MAX_ABS_MINOR, currencyExponent, fromMinor, type Money } from './Money'

/**
 * Parsing what a person types into an amount field — FINANCIAL-ENGINE.md §1.2.
 *
 * Accepts: "1,234.5", "₹1,234", "Rs. 1,234", "1 234", Indian grouping
 * ("12,34,567"), Devanagari digits and full-width digits.
 * Refuses, with a reason: "" (empty), "abc" and "1e5" (not_a_number — nobody
 * typing money means scientific notation), "1234.567" (too_many_decimals),
 * "-50" where negatives are not allowed, and anything beyond ±9 × 10^14 minor
 * units (too_large).
 */

export type ParseErrorCode =
  'empty' | 'not_a_number' | 'too_many_decimals' | 'negative_not_allowed' | 'too_large'

export interface ParseError {
  readonly code: ParseErrorCode
}

export interface ParseOptions {
  readonly allowNegative?: boolean
}

const DEVANAGARI_ZERO = 0x0966
const FULLWIDTH_ZERO = 0xff10

function normaliseDigits(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= DEVANAGARI_ZERO && code <= DEVANAGARI_ZERO + 9) {
      out += String(code - DEVANAGARI_ZERO)
    } else if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_ZERO + 9) {
      out += String(code - FULLWIDTH_ZERO)
    } else if (char === '．') {
      out += '.'
    } else if (char === '，') {
      out += ','
    } else if (char === '－' || char === '−') {
      out += '-'
    } else {
      out += char
    }
  }
  return out
}

/** Currency markers a person might type, stripped before the number is read. */
const CURRENCY_MARKERS = /₹|\brs\.?|\binr\b|\$|€|£/gi

/**
 * Every whitespace a keyboard or a paste can produce. JavaScript's `\s` is
 * Unicode-aware, so it already covers the no-break and thin spaces that
 * `Intl` puts between groups in some locales.
 */
const SPACES = /\s/g

const NUMBER = /^(-)?(\d*)(?:\.(\d*))?$/

export function parseAmount(
  raw: string,
  currency: CurrencyCode,
  options: ParseOptions = {},
): Result<Money, ParseError> {
  const cleaned = normaliseDigits(raw)
    .replace(CURRENCY_MARKERS, '')
    .replace(SPACES, '')
    .replace(/,/g, '')

  if (cleaned === '' || cleaned === '-') {
    return raw.trim() === '' ? err({ code: 'empty' }) : err({ code: 'not_a_number' })
  }

  const match = NUMBER.exec(cleaned)
  if (!match) return err({ code: 'not_a_number' })

  const [, minus, whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') return err({ code: 'not_a_number' })

  const exponent = currencyExponent(currency)
  if (fraction.length > exponent) return err({ code: 'too_many_decimals' })

  const digits = (whole === '' ? '0' : whole) + fraction.padEnd(exponent, '0')
  const magnitude = BigInt(digits)
  if (magnitude >= MAX_ABS_MINOR) return err({ code: 'too_large' })

  const negative = minus === '-' && magnitude !== 0n
  if (negative && !options.allowNegative) return err({ code: 'negative_not_allowed' })

  return ok(fromMinor(negative ? -magnitude : magnitude, currency))
}

/** The message a form shows for each code. Written once, used everywhere. */
export const PARSE_ERROR_MESSAGES: Readonly<Record<ParseErrorCode, string>> = {
  empty: 'Enter an amount.',
  not_a_number: 'Enter a number, like 1,250 or 99.50.',
  too_many_decimals: 'Use at most two digits after the decimal point.',
  negative_not_allowed: 'Enter the amount without a minus sign; the type sets the direction.',
  too_large: 'That amount is larger than this app can record.',
}
