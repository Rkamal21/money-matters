/**
 * Merchant text → a comparable string. API.md §2.10, step one.
 *
 * Bank and UPI strings are noisy in predictable ways:
 *
 *   "UPI/SWIGGY/423512/PAYTM"   → "swiggy paytm"
 *   "AMAZON PAY INDIA PRI"      → "amazon pay india pri"
 *   "UBER   INDIA SYSTEMS"      → "uber india systems"
 *   "POS 1234 BIGBASKET BLR"    → "bigbasket blr"
 *   "swiggy.upi@axisbank"       → "swiggy"
 *
 * Reference numbers and rail names go; words stay, because a `contains` rule
 * such as "air india" needs them.
 */

/** Payment-rail and reference tokens that never identify a merchant. */
const NOISE = new Set([
  'upi',
  'pos',
  'ref',
  'refno',
  'txn',
  'txnid',
  'neft',
  'imps',
  'rtgs',
  'ach',
  'nach',
  'vpa',
  'p2m',
  'p2a',
  'mcc',
  'ecom',
])

/** A UPI handle's bank suffix: the part after "@" names the bank, not the merchant. */
const UPI_HANDLE = /([a-z0-9._-]+)@[a-z0-9.]+/g

export function normalizeMerchant(raw: string): string {
  const lowered = raw.normalize('NFKC').toLowerCase()
  const withoutHandles = lowered.replace(UPI_HANDLE, (_match, local: string) =>
    local.replace(/\.?upi$/, ''),
  )

  const tokens = withoutHandles
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token !== '')
    .filter((token) => !NOISE.has(token))
    // A run of three or more digits is a reference number, not a word. "1mg" survives.
    .filter((token) => !/^\d{3,}$/.test(token))

  return tokens.join(' ')
}
