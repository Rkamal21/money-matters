import type { Money } from '../../money/Money'
import { parseAmount } from '../../money/parse'
import { isValid, type LocalDate, of } from '../../period/LocalDate'
import { type CategoryRule, type CategorySuggestion, matchRules } from '../categorize/CategoryRule'
import { normalizeMerchant } from '../categorize/normalizeMerchant'
import { type Category, categoryKindFor } from '../types'

import { fingerprintOf } from './fingerprint'
import type {
  CandidateConfidence,
  CandidateDirection,
  CandidateKind,
  ConfidenceFactor,
  ParseMessageResult,
  RejectionReason,
} from './TransactionCandidate'

/**
 * Bank / UPI message text → a transaction candidate, or a reason there is none.
 * ROADMAP.md M12 "Parser", ARCHITECTURE.md §M.3.
 *
 * Pure and deterministic: no clock, no network, no storage, no logging. The
 * text goes in, extracted fields come out, and the text is gone when this
 * returns (SECURITY.md §9). It never writes to the ledger — it has no way to.
 *
 * The rules it follows, in order:
 *
 *   1. OTPs and promotions are rejected before anything else is read, even
 *      when they quote an amount and a merchant.
 *   2. Phrases about money that has not moved — "will be debited", "is due",
 *      "requested", "if debited" — are blanked out before looking for evidence.
 *   3. An amount next to a balance word ("Avl Bal", "Avl Lmt") is a balance,
 *      not a transaction. A message with nothing else is `balance_only`.
 *   4. Direction comes from debit and credit words. When both appear, a debit
 *      wins only if every credit names the payee ("…; SWIGGY credited",
 *      "credited to VPA …"). Anything else is `unknown` — never an expense.
 *   5. The payee is read from the message's own wording; the category comes
 *      from the existing merchant rules, and only from a rule whose category is
 *      of the right kind for the direction.
 */

export interface ParseMessageInput {
  readonly text: string
  /** System rules plus the user's own — what `MerchantRuleRepository.list()` returns. */
  readonly rules: readonly CategoryRule[]
  /** The user's categories: how a rule's slug is known to be an expense or an income category. */
  readonly categories: readonly Pick<Category, 'slug' | 'kind'>[]
  /** The day the message arrived, from the source adapter. Used when the text has no date. */
  readonly receivedOn?: LocalDate
  /**
   * For an SMS: the SMS centre's send time, epoch ms, from the source adapter.
   * It tells a re-delivered SMS (same time) from a second, identically worded
   * payment (another time) when the message carries no bank reference.
   */
  readonly sentAt?: number
}

/** Longer than any multi-part bank SMS; anything bigger is not one. */
export const MAX_MESSAGE_LENGTH = 1000

/** What each piece of evidence is worth. They sum to 100. */
export const CONFIDENCE_POINTS: Readonly<Record<ConfidenceFactor, number>> = {
  amount: 30,
  direction: 25,
  merchant: 15,
  category: 10,
  reference: 10,
  account: 5,
  date: 5,
}

const FACTOR_ORDER: readonly ConfidenceFactor[] = [
  'amount',
  'direction',
  'merchant',
  'category',
  'reference',
  'account',
  'date',
]

const HIGH_CONFIDENCE = 80
const MEDIUM_CONFIDENCE = 55

// ----------------------------------------------------------------------------
// Messages that are not transactions

const OTP_WORD = String.raw`(?:otp|one[\s-]?time[\s-]?pass(?:word|code)|verification\s+code|security\s+code|passcode)`

/** An OTP being delivered — not a "never share your OTP" footer on a real transaction. */
const OTP = new RegExp(
  [
    String.raw`\b${OTP_WORD}\b.{0,80}?(?:\bis|:)\s*:?\s*\d{4,8}\b`,
    String.raw`\b\d{4,8}\s+is\s+(?:your|the)\s+${OTP_WORD}\b`,
    String.raw`\buse\s+(?:otp|code)\s*:?\s*\d{4,8}\b`,
  ].join('|'),
  'i',
)

/** Wording no completed-transaction alert uses. Rejects on sight. */
const PROMOTION = new RegExp(
  [
    String.raw`\bcongrat(?:ulation)?s\b`,
    String.raw`\bpre[\s-]?approved\b`,
    String.raw`\b(?:apply|claim|shop|buy|pay|book|order|recharge|upgrade|download|install|subscribe)\s+now\b`,
    String.raw`\bclick\b`,
    String.raw`\bhurry\b`,
    String.raw`\blimited\s+(?:time|period)\b`,
    String.raw`\buse\s+(?:code|coupon)\b`,
    String.raw`\blucky\b`,
    String.raw`\byou\s+(?:have\s+)?won\b`,
    String.raw`\b\d{1,3}\s?%\s+(?:off|cashback|discount)\b`,
    String.raw`\bget\s+(?:up\s?to|flat|instant|extra|assured)\b`,
    String.raw`\boffer\s+(?:valid|ends|expires)\b`,
  ].join('|'),
  'i',
)

/** Marketing words that a real alert can also contain — they reject only a message with no debit or credit. */
const PROMOTION_HINT =
  /\b(?:offers?|cashback|discount|sale|free|rewards?|vouchers?|coupons?)\b|https?:\/\/|\bwww\./i

/** Money that has not moved yet. Blanked out before evidence is read. */
const NOT_YET = new RegExp(
  [
    String.raw`\breceived\s+(?:a\s+)?(?:collect|payment|money)\s+request\b`,
    String.raw`\b(?:will|shall|would|to|may)\s+be\s+(?:auto[\s-]?)?(?:debited|credited|deducted|charged|refunded|reversed|paid|processed|sent|transferred)\b`,
    String.raw`\bif\s+(?:debited|credited|deducted|charged|paid)\b`,
    String.raw`\b(?:refund|reversal)\b.{0,40}?\binitiated\b`,
    String.raw`\b(?:is|are|falls)\s+due\b`,
    String.raw`\bdue\s+(?:on|by|date)\b`,
    String.raw`\brequested\b`,
    String.raw`\b(?:collect|payment|money)\s+request\b`,
    String.raw`\bscheduled\b`,
    String.raw`\breminder\b`,
  ].join('|'),
  'gi',
)

const FAILED =
  /\b(?:failed|failure|declined|unsuccessful|rejected|could\s+not\s+be\s+(?:processed|completed))\b/i

// ----------------------------------------------------------------------------
// Direction evidence

const DEBIT =
  /\b(?:debited|debit(?!\s*cards?\b)|spent|paid(?!\s+you\b)|purchase[ds]?|withdrawn|withdrawal|payment\s+made|sent(?!\s+you\b)|deducted|charged)\b/gi

/** "Payment of Rs 500 to Swiggy successful" — the app-style debit with no debit verb. */
const PAYMENT_DONE = /\bpayment\b.{0,40}?\b(?:successful(?:ly)?|success|completed|done)\b/gi

const CREDIT =
  /\b(?:credited|(?<!\b(?:avl|avbl|available)\.?\s)credit(?!\s*(?:cards?|limit|lmt|score|line|report|facility)\b)|received|deposited|paid\s+you|sent\s+you)\b/gi

const REFUND = /\b(?:refund(?:ed)?|revers(?:ed|al)|credited\s+back|chargeback)\b/i

/**
 * "We have received your payment" / "Payment of Rs 5,000 credited to your card":
 * a card bill paid or a merchant's receipt. Money moved between the user's own
 * accounts, or was already recorded from the bank's side — neither an income
 * nor a new expense, so the direction stays unknown.
 */
const PAYMENT_ACK =
  /\breceived\s+(?:your\s+)?payment\b|\bpayment\b.{0,40}?\breceived\b|\bpayment\b.{0,40}?\bcredited\b.{0,40}?\bcard\b/i

/** Enough to call it a transaction with an unknown direction, rather than noise. */
const TRANSACTION_WORDS =
  /\b(?:txn|transaction|transfer|upi|imps|neft|rtgs|ref(?:erence)?|refno|rrn|utr|a\/c|acct|account|card)\b/i

// ----------------------------------------------------------------------------
// Amounts

/** "₹1,250", "Rs.486.00", "Rs 2,000", "INR 750", "USD 12.99". */
const MARKED_AMOUNT = /(?:₹|\b(?:rs|inr|usd|eur|gbp|aed|sgd)(?![a-z]))\.?\s*\d[\d,]*(?:\.\d+)?/gi

const FOREIGN_CODE = /^(?:usd|eur|gbp|aed|sgd)/i

/** SBI writes "debited by 500.0" with no currency at all. Read only when nothing is marked. */
const BARE_AMOUNT =
  /\b(?:debited|credited|deducted|charged)\s+(?:by|for|with)\s+\d[\d,]*(?:\.\d+)?(?![\d/-])/gi

/** A word that makes the amount after it a balance or a limit. */
const BALANCE_WORD = /\b(?:bal|balance|avl|avbl|available|limit|lmt|outstanding|o\/s)\b/i

/** How far before an amount a balance word still describes it. */
const BALANCE_REACH = 40

// ----------------------------------------------------------------------------
// Payee, reference, account, date, time

const PAYEE_OUT = /\b(?:to|at|for|towards)\s+(?:(?:vpa|upi\s+id|merchant|m\/s\.?)\s+)?/gi
const PAYEE_IN = /\b(?:from|by)\s+(?:(?:vpa|upi\s+id|m\/s\.?)\s+)?/gi

/** ICICI: "Acct XX123 debited for Rs 500.00 on 03-Oct-26; SWIGGY credited." */
const PAYEE_BEFORE_CREDITED =
  /(?<=(?:^|;\s*|\.\s+))[a-z0-9&@'*][a-z0-9&@'*._/ -]{1,40}?(?=\s+credited\b)/gi

/** Payment apps: "Amit Kumar paid you ₹500", "Amit sent you ₹200" — the payer comes first. */
const PAYER_BEFORE_YOU =
  /(?<=(?:^|[.;:!]\s+))[a-z][a-z0-9&' -]{1,40}?(?=\s+(?:has\s+)?(?:paid|sent)\s+you\b)/gi

/** Axis / HDFC "UPI/P2M/427612345678/SWIGGY": the reference, then the payee. */
const UPI_PATH =
  /\bupi\/(?:[a-z0-9]{2,4}\/)?(\d{6,})\/([a-z0-9&.'@ -]{2,40}?)(?=\/|\s+(?:not|avl|bal|on|ref|call|sms)\b|[.;,]\s|[.;,]?\s*$)/i

/** Where a payee's name ends. */
const STOP_WORDS = new Set([
  'on',
  'to',
  'ref',
  'refno',
  'upi',
  'via',
  'using',
  'from',
  'for',
  'with',
  'at',
  'avl',
  'bal',
  'info',
  'not',
  'if',
  'dated',
  'date',
  'txn',
  'call',
  'sms',
  'thru',
  'through',
  'towards',
  'by',
  'and',
  'is',
  'was',
  'has',
  'vpa',
  'rrn',
  'utr',
  'imps',
  'neft',
  'rtgs',
  'a/c',
  'ac',
  'acct',
  'your',
  'transaction',
  // A direction verb ends the name: "from AMAZON credited to…".
  'credited',
  'debited',
  'received',
  'paid',
  'sent',
  'spent',
])

/** Words that describe a payment rather than name who was paid. */
const GENERIC = new Set([
  'transaction',
  'transactions',
  'txn',
  'payment',
  'payments',
  'purchase',
  'transfer',
  'order',
  'bill',
  'bills',
  'amount',
  'money',
  'fund',
  'funds',
  'your',
  'the',
  'of',
  'card',
  'account',
  'bank',
  'wallet',
  'recharge',
  'mobile',
  'subscription',
  'charges',
  'fee',
  'fees',
  'dispute',
  'disputes',
  'help',
  'assistance',
  'query',
  'queries',
  'support',
  'details',
  'more',
  'block',
  'complaint',
  'customer',
  'care',
])

/** Text that comes after "to"/"at"/"from" without being a payee. */
const NOT_A_PAYEE = /^(?:your|you|self|own|a\/c|ac|acct|account|card|rs|inr)\b|^(?:₹|[x*]+\d|\d)/i

const DATE_LIKE = /^\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?$|^\d{1,2}[a-z]{3,9}\d{2,4}$/i

const REFERENCE =
  /(?<=\b(?:upi\s*ref(?:erence)?|ref(?:erence)?|refno|rrn|utr|txn|transaction|upi)(?:\s*(?:no|num|number|id))?\.?\s*[:#-]?\s*)[a-z0-9]{6,35}\b/gi

const ACCOUNT =
  /(?<=\b(?:a\/c|acct|account|ac|card)(?:\s*no\.?)?\s*(?:ending(?:\s+(?:with|in))?\s*|[x*]+\s*))\d{3,4}\b/i

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g
const NAMED_DATE =
  /\b(\d{1,2})[-\s]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s,]*(\d{4}|\d{2})\b/gi
const NUMERIC_DATE = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g

/** HDFC cards: "on 2026-10-03:14:22:11" — the time is glued to the date. */
const STAMPED_TIME = /\b\d{4}-\d{2}-\d{2}[:T\s]([01]\d|2[0-3]):([0-5]\d)\b/
/** "14:22", "14:22:11", "02:30 PM" — and not the tail of a date or a longer number. */
const TIME = /(?<![\d:.\-/])\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s*([ap])\.?m\b\.?)?/i

// ----------------------------------------------------------------------------

interface Hit {
  readonly index: number
  readonly end: number
}

interface Resolved {
  readonly direction: CandidateDirection
  readonly kind: CandidateKind | null
}

const EXPENSE: Resolved = { direction: 'expense', kind: 'expense' }
const INCOME: Resolved = { direction: 'income', kind: 'income' }
const REFUND_IN: Resolved = { direction: 'income', kind: 'refund' }
const UNKNOWN: Resolved = { direction: 'unknown', kind: null }

const reject = (reason: RejectionReason): ParseMessageResult => ({ status: 'rejected', reason })

export function parseTransactionMessage(input: ParseMessageInput): ParseMessageResult {
  const text = input.text.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (text === '') return reject('empty')
  if (text.length > MAX_MESSAGE_LENGTH) return reject('too_long')
  if (OTP.test(text)) return reject('otp')
  if (PROMOTION.test(text)) return reject('promotional')

  const factual = text.replace(NOT_YET, (phrase) => ' '.repeat(phrase.length))
  const debits = [...hitsOf(DEBIT, factual), ...hitsOf(PAYMENT_DONE, factual)]
  const credits = hitsOf(CREDIT, factual)
  const refund = REFUND.test(factual)
  const hasEvidence = debits.length > 0 || credits.length > 0 || refund

  if (!hasEvidence && PROMOTION_HINT.test(text)) return reject('promotional')

  const amount = transactionAmount(text)
  if (amount === 'none') return reject('no_amount')
  if (amount === 'balance') return reject('balance_only')
  if (FAILED.test(factual) && !refund) return reject('failed')
  if (!hasEvidence) {
    if (factual !== text) return reject('not_completed')
    if (!TRANSACTION_WORDS.test(text)) return reject('insufficient_evidence')
  }

  const { direction, kind } = refund ? REFUND_IN : resolveDirection(factual, debits, credits)
  const upiPath = UPI_PATH.exec(text)
  const [, pathReference = '', pathPayee = ''] = upiPath ?? []

  const merchantRaw =
    (upiPath === null ? null : validPayee(pathPayee.trim())) ?? payeeOf(text, direction, kind)
  const merchant = merchantRaw === null ? null : merchantLabel(input.rules, merchantRaw)
  const category = suggestCategory(input, merchantRaw, text, kind)
  const reference = referenceOf(text) ?? (upiPath === null ? null : pathReference)
  const accountLast4 = ACCOUNT.exec(text)?.[0] ?? null
  const messageDate = dateOf(text)
  const occurredOn = messageDate ?? input.receivedOn ?? null

  return {
    status: 'candidate',
    candidate: {
      amount,
      direction,
      kind,
      merchant,
      merchantRaw,
      occurredOn,
      occurredOnSource:
        messageDate !== null ? 'message' : input.receivedOn !== undefined ? 'received' : null,
      occurredTime: timeOf(text),
      reference,
      accountLast4,
      category,
      confidence: confidenceOf({
        amount: true,
        direction: direction !== 'unknown',
        merchant: merchant !== null,
        category: category !== null,
        reference: reference !== null,
        account: accountLast4 !== null,
        date: messageDate !== null,
      }),
      fingerprint: fingerprintOf({
        amount,
        direction,
        reference,
        occurredOn,
        merchantRaw,
        accountLast4,
        messageSentAt: input.sentAt ?? null,
      }),
    },
  }
}

function hitsOf(pattern: RegExp, text: string): Hit[] {
  return Array.from(text.matchAll(pattern), (match) => ({
    index: match.index,
    end: match.index + match[0].length,
  }))
}

function resolveDirection(
  factual: string,
  debits: readonly Hit[],
  credits: readonly Hit[],
): Resolved {
  if (PAYMENT_ACK.test(factual)) return UNKNOWN
  if (credits.length === 0) return debits.length === 0 ? UNKNOWN : EXPENSE
  if (debits.length === 0) return INCOME
  const firstDebit = Math.min(...debits.map((hit) => hit.index))
  const firstCredit = Math.min(...credits.map((hit) => hit.index))
  return firstDebit < firstCredit && credits.every((hit) => namesPayee(factual, hit))
    ? EXPENSE
    : UNKNOWN
}

/**
 * Whether a "credited" after a debit is about the payee rather than the user:
 * "…; SWIGGY credited." is, "…and credited to your A/c XX5678" is not — that is
 * a transfer between the user's own accounts, and stays unknown.
 */
function namesPayee(factual: string, hit: Hit): boolean {
  const window = factual.slice(hit.end, hit.end + 30)
  const clauseEnd = window.search(/;|\.\s/)
  const after = clauseEnd === -1 ? window : window.slice(0, clauseEnd)
  return !/\byou(?:r)?\b/i.test(after)
}

/** The transaction amount, or why there is none. */
function transactionAmount(text: string): Money | 'none' | 'balance' {
  let previousEnd = 0
  let sawBalance = false
  for (const match of text.matchAll(MARKED_AMOUNT)) {
    const before = text.slice(Math.max(previousEnd, match.index - BALANCE_REACH), match.index)
    previousEnd = match.index + match[0].length
    if (BALANCE_WORD.test(before)) {
      sawBalance = true
      continue
    }
    const money = amountOf(match[0])
    if (money !== null) return money
  }
  if (sawBalance) return 'balance'
  for (const match of text.matchAll(BARE_AMOUNT)) {
    const money = amountOf(match[0].replace(/^\D+/, ''))
    if (money !== null) return money
  }
  return 'none'
}

/** The existing amount parser does the arithmetic; a zero or malformed amount is no amount. */
function amountOf(token: string): Money | null {
  const code = FOREIGN_CODE.exec(token)
  const currency = code === null ? 'INR' : code[0].toUpperCase()
  const parsed = parseAmount(token.replace(/^(?:₹|[a-z]+)\.?/i, ''), currency)
  return parsed.ok && parsed.value.minor > 0n ? parsed.value : null
}

function payeeOf(
  text: string,
  direction: CandidateDirection,
  kind: CandidateKind | null,
): string | null {
  if (direction === 'expense') {
    for (const match of text.matchAll(PAYEE_BEFORE_CREDITED)) {
      const payee = validPayee(match[0].trim())
      if (payee !== null) return payee
    }
  }
  if (kind === 'income') {
    for (const match of text.matchAll(PAYER_BEFORE_YOU)) {
      const payer = validPayee(match[0].trim())
      if (payer !== null) return payer
    }
  }
  const prefixes =
    kind === 'income'
      ? [PAYEE_IN]
      : direction === 'expense'
        ? [PAYEE_OUT]
        : kind === 'refund'
          ? [PAYEE_IN, PAYEE_OUT]
          : [PAYEE_OUT, PAYEE_IN]
  for (const prefix of prefixes) {
    for (const match of text.matchAll(prefix)) {
      const payee = payeeAt(text, match.index + match[0].length)
      if (payee !== null) return payee
    }
  }
  return null
}

/** The words after "to" / "at" / "from", up to where the name plainly ends. */
function payeeAt(text: string, start: number): string | null {
  const kept: string[] = []
  for (const word of text.slice(start, start + 100).split(' ')) {
    const bare = word.replace(/[.,;:!?)|]+$/, '')
    if (
      bare === '' ||
      kept.length === 5 ||
      STOP_WORDS.has(bare.toLowerCase()) ||
      DATE_LIKE.test(bare)
    ) {
      break
    }
    kept.push(bare)
    if (bare !== word) break
  }
  return validPayee(kept.join(' '))
}

/** A payee must name someone: at least one real word that is not payment vocabulary. */
function validPayee(raw: string): string | null {
  if (NOT_A_PAYEE.test(raw)) return null
  const words = normalizeMerchant(raw)
    .split(' ')
    .filter((word) => !GENERIC.has(word))
  return words.some((word) => /[a-z].*[a-z]/.test(word)) ? raw : null
}

/** The rule's label when one matches ("SWIGGY" → "Swiggy"); otherwise the payee, tidied. */
function merchantLabel(rules: readonly CategoryRule[], raw: string): string {
  return (
    matchRules(rules, raw)?.merchantLabel ??
    normalizeMerchant(raw)
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  )
}

/**
 * The existing rules, restricted to rules whose category is of the right kind:
 * an expense never gets "Salary", and income from "AMAZON" never gets
 * "Shopping". With no payee, income alone also tries the whole message, where
 * "SALARY" or "PAYROLL" usually appears; an expense does not, because a debit
 * alert is full of bank names ("Airtel Payments Bank") that are not the payee.
 */
function suggestCategory(
  input: ParseMessageInput,
  merchantRaw: string | null,
  text: string,
  kind: CandidateKind | null,
): CategorySuggestion | null {
  if (kind === null) return null
  const expected = categoryKindFor(kind)
  const kinds = new Map(input.categories.map((category) => [category.slug, category.kind]))
  const eligible = input.rules.filter((rule) => kinds.get(rule.categorySlug) === expected)
  const fromPayee = merchantRaw === null ? null : matchRules(eligible, merchantRaw)
  return fromPayee ?? (kind === 'income' ? matchRules(eligible, text) : null)
}

function referenceOf(text: string): string | null {
  for (const match of text.matchAll(REFERENCE)) {
    if (match[0].replace(/\D/g, '').length >= 4) return match[0].toUpperCase()
  }
  return null
}

function dateOf(text: string): LocalDate | null {
  for (const [, y = '', m = '', d = ''] of text.matchAll(ISO_DATE)) {
    const date = civil(Number(y), Number(m), Number(d))
    if (date !== null) return date
  }
  for (const [, d = '', month = '', y = ''] of text.matchAll(NAMED_DATE)) {
    const date = civil(fullYear(y), MONTHS.indexOf(month.toLowerCase()) + 1, Number(d))
    if (date !== null) return date
  }
  for (const [, d = '', m = '', y = ''] of text.matchAll(NUMERIC_DATE)) {
    const date = civil(fullYear(y), Number(m), Number(d))
    if (date !== null) return date
  }
  return null
}

/** Indian messages write day first; a two-digit year is this century. */
const civil = (y: number, m: number, d: number): LocalDate | null =>
  isValid(y, m, d) ? of(y, m, d) : null
const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y))

function timeOf(text: string): string | null {
  const stamped = STAMPED_TIME.exec(text)
  if (stamped !== null) {
    const [, hour = '', minute = ''] = stamped
    return `${hour}:${minute}`
  }
  const match = TIME.exec(text)
  if (match === null) return null
  const [, h = '', minute = '', meridiem] = match
  let hour = Number(h)
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (meridiem.toLowerCase() === 'p' ? 12 : 0)
  }
  return `${String(hour).padStart(2, '0')}:${minute}`
}

function confidenceOf(found: Readonly<Record<ConfidenceFactor, boolean>>): CandidateConfidence {
  const breakdown = FACTOR_ORDER.filter((factor) => found[factor]).map((factor) => ({
    factor,
    points: CONFIDENCE_POINTS[factor],
  }))
  const score = breakdown.reduce((sum, item) => sum + item.points, 0)
  return {
    score,
    level: score >= HIGH_CONFIDENCE ? 'high' : score >= MEDIUM_CONFIDENCE ? 'medium' : 'low',
    breakdown,
  }
}
