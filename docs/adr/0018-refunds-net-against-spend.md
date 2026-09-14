# ADR-0018 — Refunds net against spending rather than counting as income

Status: **Proposed** · Date: 2026-09-07

## Context

A returned ₹2,000 shirt puts ₹2,000 back in the account. Two representations are possible:

1. Record it as **income**. Simple; requires no new kind; but the month then shows ₹2,000 of
   "income" that is not earnings, and the Shopping category still shows ₹2,000 spent that was not.
2. Record it as a **refund** that reverses part of a specific expense.

An earlier draft of this architecture assumed (1). This ADR overrides that assumption.

## Decision

`transaction_kind = 'refund'`. A refund increases the account balance (like income) but counts as
**negative spend** in category totals, budget usage, and the safe daily limit — not as income.
`refund_of_transaction_id` optionally links it to the original expense.

Net spend per category is floored at zero for display, but the raw signed value is what feeds the
calculations.

## Alternatives

1. **Refund as income** (the earlier assumption).
2. **Edit or delete the original transaction.**
3. **A negative-amount expense.**

## Reasoning

Option 1 corrupts two of the product's headline numbers simultaneously. The savings rate
`(income − expense) / income` inflates on both sides. The Shopping budget shows ₹2,000 consumed
that was returned, so the safe daily limit under-reports what the user can spend — the app gives
worse advice than doing nothing.

Option 2 destroys history. "I bought it and returned it" is a true and useful fact; a deleted row
cannot be reconciled against a bank statement.

Option 3 breaks the invariant that `amount_minor > 0` and that direction is carried by `kind` —
the single constraint that stopped v1's "insert a negative expense to inflate your balance" hole.
Reintroducing signed amounts to save one enum value would be a poor trade.

## Tradeoffs

- **A fourth transaction kind** to handle in the view, the forms, the filters, and the analytics.
  Contained, and the enum forces the compiler to find every site.
- **A category can show negative net spend** in a period where a refund exceeds that period's
  spending (returned in October, bought in September). Displayed as ₹0 with the true value in the
  detail view; the calculation floors at zero so a refund cannot manufacture spending headroom that
  the budget did not have.
- **Contradicts an earlier written assumption**, which is the point of an ADR: the assumption was
  reviewed, found wrong, and replaced in writing rather than silently.

## Consequences

- `calculateSafeDailyLimit` takes `refundsAgainstVariable` and nets it, floored at zero
  (FINANCIAL-ENGINE.md §3.2, assumption S3).
- `get_period_summary` returns `refund_minor` separately from `income_minor`.
- The E2E suite asserts a refund reduces net spend and does **not** increase income.
