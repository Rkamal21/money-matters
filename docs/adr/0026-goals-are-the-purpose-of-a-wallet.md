# ADR-0026 — A goal is the purpose of a wallet; its progress is the wallet's ledger balance

Status: **Accepted** · Date: 2026-09-13 · Supersedes [ADR-0010](./0010-goal-progress-trigger-maintained.md)

## Context

ADR-0010 made `goal_contributions` an append-only ledger and `goals.saved_minor` a
trigger-maintained cache over it. That closed v1's browser-writable `goals.current`, but it left a
structural problem: the contribution ledger was a **second ledger**. `goal_contributions.transaction_id`
was nullable and `source` could be `manual`, so "saved ₹5,000 towards the laptop" could be recorded
with no money moving between any accounts. The goal then reported ₹5,000 that no account balance
contained — a second balance, free to disagree with the first, and invisible to the balances widget,
the safe daily limit, and every analytics query.

The principle this ADR records:

- **The existing ledger is the single source of truth** for where money is: `transactions`, expanded
  into signed legs by `account_entries` ([ADR-0017](./0017-single-row-transfers-with-entry-view.md)).
- **A wallet is a specialised account** — a container for money.
- **A goal is the purpose of money, not a second balance.**

## Decision

- A **wallet** is an `accounts` row with `type = 'wallet'`. The existing enum value is kept and its
  meaning widened to any container of money with a purpose — an e-wallet balance, or a pot set aside
  for a goal. It is an account in every respect: its balance comes from `account_balances`, and money
  enters and leaves it only through `transactions`.
- Every **goal is backed by exactly one wallet** (`goals.wallet_account_id NOT NULL`), and a wallet
  backs **at most one goal** (`UNIQUE`). The reference is a composite foreign key
  `(wallet_account_id, user_id, wallet_account_type) → accounts (id, user_id, type)` with
  `wallet_account_type` pinned to `'wallet'`. Pointing a goal at a bank account, pointing it at
  another user's wallet, or retyping a wallet that backs a goal are all `23503` at the storage layer.
- **A goal's progress is its wallet's balance**, read from `goal_progress` — a `security_invoker`
  view over `account_balances` and `account_entries`. Nothing about progress is stored.
- **Contributing is a transfer** into the wallet. Withdrawing is a transfer out. Spending the money
  on its purpose is an expense from the wallet. All three are ordinary transactions.
- **Achieved is derived, and it sticks.** `goal_progress.reached` is true once the wallet's running
  balance has ever met the target, or its opening balance does. `reached_on` is the first
  `occurred_on` on which it did. Buying the laptop lowers the balance; it does not un-achieve the
  goal. Editing a back-dated transaction can move `reached_on`, which is correct — it is derived from
  the ledger, so it follows the ledger.
- A goal's wallet is **fixed at creation**: `wallet_account_id` is in the `INSERT` grant and absent
  from the `UPDATE` grant. Re-pointing a goal at a fuller wallet would complete it with no money
  moving.
- **Removed:** `goal_contributions`, `goals.saved_minor`, `goals.achieved_at`, `goals.currency_code`
  (the wallet's currency is the goal's), `goals.linked_account_id`, `sync_goal_saved()`,
  `recompute_goal_totals()`, `add_goal_contribution()`, and the `contribution_source` enum.

## Alternatives

1. **Keep ADR-0010** — a contribution ledger with a trigger-maintained total.
2. **Goal-tagged transfers** — goals may share a wallet; transfers carry an optional `goal_id`;
   progress is the net of the transfers tagged to the goal.
3. **Earmarks** — a `goal_allocations` table assigns portions of a wallet's balance to goals,
   re-allocatable without a transaction.

## Reasoning

Option 1 is the second balance this ADR exists to remove. Making `transaction_id` mandatory would
have tied every contribution to real money, but it would still record one movement twice — the
transfer and its contribution row — and the two can be edited, deleted and back-dated
independently. That is the paired-row problem ADR-0017 rejected for transfers.

Options 2 and 3 both let several goals share one wallet, which is their real advantage. Both pay for
it with a stored amount per goal (a tag sum or an allocation) that the wallet's balance does not
constrain. An untagged expense from the wallet, or a withdrawal, leaves the goals claiming more
than the wallet holds. The app never blocks reality ([PRODUCT.md §4](../PRODUCT.md) principle 4),
so that cannot be prevented, only detected. Detection needs an "underfunded" state plus a rule for
which goal loses first. That reconciliation problem would come from the model, not from the user's
money.

The chosen design has nothing to reconcile. A goal's number *is* an account balance, so it cannot
disagree with the balances widget. It is already covered by every invariant the ledger has:
positive amounts, composite FKs, idempotency keys, soft delete and audit. The safe daily limit
already treats a transfer into it as saving rather than spending. The design also retires the
performance argument that justified ADR-0010's cache: the goals list reads the same per-account
aggregate the balances widget already reads, over a handful of wallet entries.

## Tradeoffs

- **One wallet per goal.** Two goals cannot share a pot. A user saving for a laptop and a holiday in
  one savings account either creates two wallets or tracks one combined goal. Wallets are cheap
  rows, and this was judged the right price for having no reconciliation state. Option 2 is the
  migration path if it proves wrong, and it is additive (a nullable `goal_id` on `transactions`).
- **A wallet is never re-used for a second goal.** `UNIQUE` covers archived goals too, so an archived
  goal's history always means one thing. A new goal means a new wallet, plus a transfer if the money
  should move with it.
- **Progress can go negative** if the wallet does — an expense recorded against an empty wallet.
  The ledger does not refuse it; the UI shows it.
- **Creating a goal with a new wallet is two writes** (the account, then the goal). If the second
  fails, an empty wallet remains. Nothing is inconsistent, because no money is in it, and the goal
  form retries against the same wallet.
- **Wallet money counts in total balances.** That is correct: it is the user's money. The goals
  widget is where its purpose is shown.
- **`reached` costs a windowed aggregate per goal on read** instead of a stored flag. Wallets have
  few entries, and `tx_user_account_idx` and `tx_user_counter_idx` already serve both branches.

## Consequences

- ADR-0010 is superseded. ADR-0019 and ADR-0020 are Accepted and are not edited. Their decisions
  stand for every remaining authoritative column (`xp_total`, `is_system`, `status`, `is_split`).
  Their `goals.saved_minor` and `sync_goal_saved()` examples now describe a column and a trigger that
  do not exist.
- **Goal XP moves from the RPC into `on_transaction_awards_xp()` (M9).** A transfer into a goal's
  wallet is awarded as `goal_contribution` (`contrib:<transaction id>`) instead of
  `transaction_logged`. The first transaction that makes `goal_progress.reached` true awards
  `goal_achieved` (`goal:<goal id>`, once ever). Nothing in M6 calls `award_xp()`.
- The only trigger-maintained cache left in the system is `gamification_profiles.xp_total`.
- `goal_progress` is covered by the `security_invoker` assertion in
  [SECURITY.md §8.2](../SECURITY.md), like every other view.
- Concurrency needs no lock: twenty simultaneous transfers into one wallet produce a balance equal to
  their sum, because the balance *is* a sum.
