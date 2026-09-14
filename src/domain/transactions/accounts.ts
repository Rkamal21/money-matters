import { add, max, negate, subtract, sumAll, type Money, zero } from '../money/Money'

import type { AccountType } from './types'

/**
 * Account-level derived numbers. The balance itself comes from the
 * `account_balances` view; these only combine balances for display.
 */

/** Everything the user has, cards subtracted: the sum of every balance, signs included. */
export function netWorth(
  accounts: readonly { readonly balance: Money }[],
  currency: string,
): Money {
  return sumAll(
    accounts.map((account) => account.balance),
    currency,
  )
}

/** A card's derived balance goes negative with spending; "owed" is its negation, floored at zero. */
export function amountOwed(balance: Money): Money {
  return max(zero(balance.currency), negate(balance))
}

/** Available credit: limit + balance (balance is negative when owed). */
export function availableCredit(limit: Money, balance: Money): Money {
  return max(zero(limit.currency), add(limit, balance))
}

/**
 * The opening balance to store for what a person means by "current balance".
 * For a credit card they type what they owe, which the ledger records as a
 * negative balance (DATABASE.md §6.2 "one sign convention").
 */
export function openingBalanceFromEntry(type: AccountType, entered: Money): Money {
  return type === 'credit_card' ? negate(entered) : entered
}

/** Assets minus liabilities, split for a summary tile. */
export function assetsAndLiabilities(
  accounts: readonly { readonly balance: Money; readonly type: AccountType }[],
  currency: string,
): { readonly assets: Money; readonly liabilities: Money } {
  const nothing = zero(currency)
  let assets = nothing
  let liabilities = nothing
  for (const account of accounts) {
    if (account.balance.minor >= 0n) assets = add(assets, account.balance)
    else liabilities = add(liabilities, negate(account.balance))
  }
  return { assets, liabilities: max(nothing, subtract(liabilities, nothing)) }
}
