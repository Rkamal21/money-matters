import { z } from 'zod'

import type { Money } from '@/domain/money/Money'
import { parseAmount, PARSE_ERROR_MESSAGES } from '@/domain/money/parse'

/**
 * Form helpers shared by every feature. Zod validates for UX; the database
 * validates for truth (ARCHITECTURE.md §I.4). An amount field stays a string
 * in the form and becomes `Money` exactly once, at submit, through
 * `parseAmount` — the input boundary FINANCIAL-ENGINE.md §1.2 describes.
 */

export interface AmountFieldOptions {
  readonly required?: boolean
  readonly allowZero?: boolean
  readonly allowNegative?: boolean
  readonly currency?: string
}

export function amountField(options: AmountFieldOptions = {}) {
  const required = options.required ?? true
  return z.string().superRefine((value, ctx) => {
    if (value.trim() === '') {
      if (required) ctx.addIssue({ code: 'custom', message: PARSE_ERROR_MESSAGES.empty })
      return
    }
    const result = parseAmount(value, options.currency ?? 'INR', {
      allowNegative: options.allowNegative ?? false,
    })
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: PARSE_ERROR_MESSAGES[result.error.code] })
      return
    }
    if (!(options.allowZero ?? false) && result.value.minor === 0n) {
      ctx.addIssue({ code: 'custom', message: 'Enter an amount greater than zero.' })
    }
  })
}

/** Parse an already-validated amount. Throws on invalid input, which validation has ruled out. */
export function toMoney(value: string, currency: string, allowNegative = false): Money {
  const result = parseAmount(value, currency, { allowNegative })
  if (!result.ok) throw new RangeError(`unvalidated amount: ${result.error.code}`)
  return result.value
}

export function toMoneyOrNull(value: string, currency: string): Money | null {
  return value.trim() === '' ? null : toMoney(value, currency)
}

/** An idempotency key, generated once per form submission (DATABASE.md §12). */
export function newRequestId(): string {
  // `randomUUID` exists only in secure contexts (https, localhost). A phone
  // opening the dev server over the local network is neither, so there the
  // same RFC 4122 v4 UUID is built from `getRandomValues`, which is not
  // restricted.
  if (globalThis.isSecureContext) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40 // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const emailField = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('Enter a valid email address.')

/** A short list of the passwords that fall first. GoTrue enforces the length too. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  '1234567890',
  '0123456789',
  'qwertyuiop',
  'iloveyou12',
  'moneymatters',
  'letmein123',
  '1q2w3e4r5t',
  'asdfghjkl1',
])

export const newPasswordField = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(72, 'Use at most 72 characters.')
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'That password is too common. Choose another.',
  )
