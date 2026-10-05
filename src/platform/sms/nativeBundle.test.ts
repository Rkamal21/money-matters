import { runInNewContext } from 'node:vm'

import { beforeAll, describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORIES } from '@/config/categories.generated'
import { of } from '@/domain/period/LocalDate'
import { parseTransactionMessage } from '@/domain/transactions/ingest/parseTransactionMessage'
import { confirmationRequestId } from '@/domain/transactions/ingest/review'
import { MESSAGES, RULES } from '@tests/fixtures/detection'

// @ts-expect-error -- a plain .mjs build script, without type declarations
import { buildSmsParser } from '../../../scripts/build-sms-parser.mjs'

import { candidateToJSON } from './candidateJson'
import { noticeFor } from './notice'
import type { BridgeOutput } from './parserBridge'

/**
 * The exact JavaScript the Android receiver evaluates (assets/sms-parser.js),
 * built in memory and run in a bare V8 context — no TextEncoder, no DOM, no
 * fetch, like JavaScriptSandbox. It must agree with the app's parser on every
 * message: the phone and the app run one parser, not two.
 */

const categories = DEFAULT_CATEGORIES.map(({ slug, kind, name }) => ({ slug, kind, name }))
/** What the app hands Android (DetectionListener → syncContext): one bank account, ending 1234. */
const AUTO = {
  currency: 'INR',
  autoAdd: true,
  accounts: [{ type: 'bank', last4: '1234', isArchived: false }],
}
const BUNDLE_TIMEOUT = 60_000

let bundle: string

beforeAll(async () => {
  bundle = (await buildSmsParser({ write: false })) as string
}, BUNDLE_TIMEOUT)

/** A fresh, bare context per call; `prepare` can strip built-ins first. */
function runBundle(input: object, prepare = ''): BridgeOutput {
  const context: Record<string, unknown> = {}
  const call = `${prepare};${bundle};MoneyMattersSms.parse(${JSON.stringify(JSON.stringify(input))})`
  return JSON.parse(runInNewContext(call, context) as string) as BridgeOutput
}

const SAMPLES = [
  MESSAGES.expense,
  MESSAGES.income,
  MESSAGES.unknown,
  MESSAGES.sbi,
  MESSAGES.airtel,
  MESSAGES.otp,
  MESSAGES.promo,
  'Your A/c XX1234 balance is Rs 10,000 as on 03-Oct',
  'Rs.486.00 debi',
  'Refund of Rs 300 from AMAZON credited to your A/c XX1234',
  'Rs ４８６.００ debited from A/c XX1234 to SWIGGY',
]

describe('assets/sms-parser.js — the parser as the phone runs it', () => {
  it('needs nothing outside ECMAScript', () => {
    expect(bundle).not.toContain('TextEncoder')
    expect(bundle).not.toMatch(/\bfetch\(|XMLHttpRequest|localStorage|document\./)
  })

  it.each(SAMPLES)('agrees with the app’s parser: %j', (text) => {
    const input = {
      text,
      sentAt: 1_790_000_000_000,
      receivedOn: '2026-10-05',
      rules: RULES,
      categories,
    }
    const app = parseTransactionMessage({
      text,
      rules: RULES,
      categories,
      sentAt: 1_790_000_000_000,
      receivedOn: of(2026, 10, 5),
    })
    const expected: BridgeOutput =
      app.status === 'rejected'
        ? { status: 'rejected', reason: app.reason }
        : {
            status: 'candidate',
            candidate: candidateToJSON(app.candidate),
            requestId: confirmationRequestId(app.candidate.fingerprint),
            auto: false,
            notice: noticeFor(app.candidate),
            capture: null,
            samePaymentAs: null,
          }
    expect(runBundle(input)).toEqual(expected)
  })

  it('writes the notification the user sees', () => {
    const output = runBundle({ text: MESSAGES.expense, rules: RULES, categories })
    expect(output).toMatchObject({
      status: 'candidate',
      notice: {
        title: 'Transaction detected',
        text: 'Money Matters detected a ₹486 payment at Swiggy.',
        publicText: 'Money Matters found a transaction to review.',
      },
    })
  })

  it('marks a clear payment for adding and words its notification so, with the category', () => {
    const output = runBundle({ text: MESSAGES.expense, rules: RULES, categories, ...AUTO })
    expect(output).toMatchObject({
      status: 'candidate',
      auto: true,
      notice: {
        title: 'Transaction added',
        text: 'Money Matters added a ₹486 payment at Swiggy to Food.',
        publicText: 'Money Matters added a transaction.',
      },
    })
  })

  it('keeps it for review when the switch is off, or the account is not certain', () => {
    const off = runBundle({
      text: MESSAGES.expense,
      rules: RULES,
      categories,
      ...AUTO,
      autoAdd: false,
    })
    expect(off).toMatchObject({ auto: false, notice: { title: 'Transaction detected' } })
    const twoBanks = runBundle({
      text: MESSAGES.expense,
      rules: RULES,
      categories,
      ...AUTO,
      accounts: [
        { type: 'bank', last4: null, isArchived: false },
        { type: 'savings', last4: null, isArchived: false },
      ],
    })
    expect(twoBanks).toMatchObject({ auto: false })
  })

  it('never adds without being told the ledger currency', () => {
    const { currency: _currency, ...noCurrency } = AUTO
    expect(
      runBundle({ text: MESSAGES.expense, rules: RULES, categories, ...noCurrency }),
    ).toMatchObject({
      auto: false,
    })
  })

  it('remembers a live SMS’s figures, and recognises the payment app’s notification of it', () => {
    const sms = runBundle({
      text: 'Dear UPI user A/C X1234 debited by 486.00 on date 03Oct26 trf to Swiggy Refno 900000000501',
      sentAt: 1_790_000_000_000,
      source: 'sms',
      rules: RULES,
      categories,
    })
    if (sms.status !== 'candidate' || sms.capture === null) throw new Error('no capture')
    expect(sms.capture).toMatchObject({ source: 'sms', direction: 'expense', amountMinor: '48600' })
    expect(sms.samePaymentAs).toBeNull()

    const notification = runBundle({
      text: '₹486 paid to Swiggy. Paid from SBI ••1234',
      sentAt: 1_790_000_030_000,
      source: 'notification',
      recent: [sms.capture],
      rules: RULES,
      categories,
    })
    expect(notification).toMatchObject({
      status: 'candidate',
      samePaymentAs: sms.capture.fingerprint,
    })
  })

  it('does not match an inbox import across sources', () => {
    const output = runBundle({ text: MESSAGES.expense, source: 'import', rules: RULES, categories })
    expect(output).toMatchObject({ capture: null, samePaymentAs: null })
  })

  it('still parses where the engine has no ICU normalize', () => {
    const output = runBundle(
      { text: MESSAGES.expense, rules: RULES, categories },
      'delete String.prototype.normalize',
    )
    expect(output.status).toBe('candidate')
  })

  it('parses without rules or categories — the merchant still read, no category guessed', () => {
    const output = runBundle({ text: MESSAGES.expense })
    expect(output).toMatchObject({
      status: 'candidate',
      candidate: { merchant: 'Swiggy', category: null, amount: { minor: '48600' } },
    })
  })

  it('answers malformed input with a bare error, echoing nothing', () => {
    const context: Record<string, unknown> = {}
    const raw = runInNewContext(`${bundle};MoneyMattersSms.parse('{not json')`, context) as string
    expect(JSON.parse(raw)).toEqual({ status: 'error' })
    expect(raw).not.toContain('not json')
  })
})
