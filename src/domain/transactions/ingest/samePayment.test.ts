import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORIES } from '@/config/categories.generated'

import { parseTransactionMessage } from './parseTransactionMessage'
import { captureOf, type RecentCapture, SAME_PAYMENT_WITHIN_MS, samePayment } from './samePayment'
import type { TransactionCandidate } from './TransactionCandidate'

// Messages are anonymised: real formats, invented values.
const SMS =
  'Dear UPI user A/C X1234 debited by 486.00 on date 03Oct26 trf to Swiggy Refno 900000000501'
const NOTIFICATION = '₹486 paid to Swiggy. Paid from SBI ••1234'
const CREDIT = '₹486 received from Amit. Credited to SBI ••1234'
const T = 1_790_000_000_000

function candidate(text: string): TransactionCandidate {
  const result = parseTransactionMessage({
    text,
    rules: [],
    categories: DEFAULT_CATEGORIES,
    sentAt: T,
  })
  if (result.status !== 'candidate') throw new Error(result.reason)
  return result.candidate
}

function captured(text: string, source: 'sms' | 'notification', at: number): RecentCapture {
  const capture = captureOf(candidate(text), source, at)
  if (capture === null) throw new Error('no capture')
  return capture
}

describe('samePayment — one payment, an SMS and a notification', () => {
  it('pairs the payment app’s notification with the bank’s SMS for the same payment', () => {
    const sms = captured(SMS, 'sms', T)
    expect(samePayment(candidate(NOTIFICATION), 'notification', T + 20_000, [sms])).toBe(sms)
  })

  it('pairs either way round', () => {
    const notification = captured(NOTIFICATION, 'notification', T)
    expect(samePayment(candidate(SMS), 'sms', T + 90_000, [notification])).toBe(notification)
  })

  it('never pairs two messages from the same source — two chais are two payments', () => {
    const first = captured(NOTIFICATION, 'notification', T)
    expect(samePayment(candidate(NOTIFICATION), 'notification', T + 30_000, [first])).toBeNull()
  })

  it('pairs one-to-one: a capture already paired takes no second partner', () => {
    const sms = { ...captured(SMS, 'sms', T), paired: true }
    expect(samePayment(candidate(NOTIFICATION), 'notification', T + 20_000, [sms])).toBeNull()
  })

  it('does not pair across the fifteen-minute window, other amounts, or the other direction', () => {
    const sms = captured(SMS, 'sms', T)
    expect(
      samePayment(candidate(NOTIFICATION), 'notification', T + SAME_PAYMENT_WITHIN_MS + 1, [sms]),
    ).toBeNull()
    expect(
      samePayment(candidate('₹487 paid to Swiggy'), 'notification', T + 1_000, [sms]),
    ).toBeNull()
    expect(samePayment(candidate(CREDIT), 'notification', T + 1_000, [sms])).toBeNull()
  })

  it('takes the closest in time', () => {
    const far = captured(SMS, 'sms', T - 600_000)
    const near = { ...captured(SMS, 'sms', T - 60_000), fingerprint: 'near' }
    expect(samePayment(candidate(NOTIFICATION), 'notification', T, [far, near])).toBe(near)
  })

  it('remembers figures only — no payee, no text', () => {
    expect(captureOf(candidate(NOTIFICATION), 'notification', T)).toEqual({
      source: 'notification',
      direction: 'expense',
      amountMinor: '48600',
      currency: 'INR',
      at: T,
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      paired: false,
    })
  })
})
