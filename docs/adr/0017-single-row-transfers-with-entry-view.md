# ADR-0017 — One transaction row per transfer, expanded by an `account_entries` view

Status: **Proposed** · Date: 2026-09-07

## Context

The brief is emphatic: a transfer between the user's own accounts must not appear as income or as
expense. v1 could not express a transfer at all — moving ₹10,000 to savings was recorded as an
expense, which corrupted every spending total and made the safe daily limit meaningless for anyone
who saves.

The design question is how to represent a movement that debits one account and credits another.

## Decision

**One row** in `transactions` with `kind = 'transfer'`, `account_id` (source) and
`counter_account_id` (destination), and a `CHECK` requiring both to be present and different and
`category_id` to be null.

Balances and analytics do not read `transactions` directly. They read
`account_entries` — a view that expands each transaction into one signed leg (income, expense,
refund) or **two** signed legs (transfer out, transfer in).

## Alternatives

1. **Full double-entry**: a `transactions` header plus a `transaction_entries` table with signed
   amounts per account. Every expense writes two rows.
2. **Paired rows**: two `transactions` rows linked by a `transfer_group_id`.
3. **A separate `transfers` table.**

## Reasoning

Option 1 is the textbook answer and is genuinely correct. It was rejected for this product because
it doubles (or more) the row count for the 95% case — a simple expense — requires an RPC for every
write to keep the legs consistent, and forces every UI surface to reassemble a user-visible
"transaction" from entries. It is the right model for a general ledger with counter-accounts; it is
heavier than a personal finance app needs.

Option 2 has the consistency problem the design is trying to eliminate: two rows that must agree,
can be edited independently, and can be half-deleted. That is exactly the class of bug that makes
money inconsistent.

Option 3 splits the ledger into two tables, so every list, filter, search, and aggregate becomes a
`UNION` written by hand at each call site.

The chosen design keeps a single authoritative row per user-visible event — one thing to create,
edit, delete, and audit — while giving aggregates the clean two-legged shape they want. **The view
is derived, so it cannot disagree with the table.** If the row count ever justifies it,
`account_entries` can become a materialised table without changing a single query above the data
layer.

## Tradeoffs

- **Not general double-entry.** A future need for split-across-accounts, multi-leg settlements, or
  true counter-accounts would require migrating to option 1. Judged unlikely for a personal finance
  product; recorded so the cost is known.
- **Two indexes for balances** — one on `(user_id, account_id, …)` and a partial one on
  `(user_id, counter_account_id, …)` — because the view's two branches scan differently.
- **`counter_account_id` is null for 95% of rows.** Cheap in PostgreSQL, and the partial index
  ignores them.

## Consequences

- `get_period_summary` reports transfers separately and excludes them from income and expense. The
  E2E suite asserts a ₹10,000 transfer moves both balances and changes neither total.
- `account_balances` is a view over `account_entries`; no balance column exists anywhere.
- Adding a transaction kind means adding a `CASE` branch in the view — which is precisely why
  `transaction_kind` is an enum rather than a table.
