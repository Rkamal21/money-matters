# ADR-0021 — The safe daily limit uses `greater(planned, actual)` income

Status: **Accepted** · Date: 2026-09-08 · Supersedes assumption A9 in [ARCHITECTURE.md §0](../ARCHITECTURE.md)

## Context

The safe daily limit is the product's hero number — the one figure
[PRODUCT.md](../PRODUCT.md) calls "the product's spine", and the reason the app exists rather than
being another expense tracker. Its first input is "how much income does this period have?", and two
documents answered differently:

- **ARCHITECTURE.md assumption A9:** "'Expected income' for the safe daily limit is the *planned*
  figure from the budget, not the sum of actual income transactions."
- **FINANCIAL-ENGINE.md §3.1 and assumption S1:** `policy.incomeBasis` defaults to `'greater'` —
  `max(expectedIncome, incomeReceived)` — with S1 arguing explicitly against `'planned'`.

A8, the other superseded assumption in that table, was struck through in writing when
[ADR-0018](./0018-refunds-net-against-spend.md) overrode it. A9 was not, so both readings stayed
live for three drafts. Since the two produce different numbers for any user whose receipts differ
from their plan, this had to be decided before Milestone 5 rather than discovered in a PR.

## Decision

**`incomeBasis` defaults to `'greater'`:** `income = max(expectedIncome, incomeReceived)`.

All three bases remain implemented, selectable, and tested — the field exists in the contract, and
strategy selection is a profile preference — but `'greater'` is what ships and what the breakdown
panel explains.

## Alternatives

1. **`'planned'`** — assumption A9 as written. Budget strictly against the plan.
2. **`'actual'`** — budget only against money actually received.
3. **`'greater'`** — the plan, unless receipts have already exceeded it.

## Reasoning

Option 2 is disqualified by the calendar: for a salaried user paid on the 1st, `incomeReceived` is
₹0 for the first hours of the period and the limit reads ₹0 or `insufficient_data` — the app is
least useful exactly when the month is most open. For a freelancer it is worse, because a lean
month reads as ₹0/day rather than "spend carefully".

Option 1 is genuinely defensible and is the conservative choice: it ignores a bonus until the user
re-plans, which keeps the number stable and makes it obvious that the plan is what drives it. It
was rejected on the user shapes in [PRODUCT.md §6](../PRODUCT.md). Ravi's income is "lumpy,
₹0–200k per month" — the whole reason `expectedIncome` and `incomeReceived` are separate inputs is
that his plan is a guess and his receipts are a fact. Under `'planned'`, a ₹200k month is spendable
only after he edits his budget, and a finance app that requires paperwork before it acknowledges
money that has arrived is one people stop trusting.

`'greater'` is also the only option that never *overstates*: it takes the plan as a floor and
raises it only against money that is provably in an account. It cannot invent income the way
`'actual'` can hide it.

The honest cost is stated in the tradeoffs: it treats a windfall as immediately spendable, which is
a defensible position for a tool that advises rather than enforces
([FINANCIAL-ENGINE.md](../FINANCIAL-ENGINE.md) assumption S8) but is not the only defensible one.

## Tradeoffs

- **A bonus becomes spendable the day it lands**, spread across the days remaining, rather than
  being carried into next month's plan. A user saving a windfall deliberately will see their limit
  rise, which is the opposite of helpful. Mitigated by the breakdown line naming the actual receipt,
  so the number is explainable; a `GoalAwareStrategy` (§3.6) is the real answer later.
- **The limit can move for a reason the user did not initiate** — income arriving changes it. The
  breakdown makes it visible; the alternative is a number that silently ignores reality.
- **Three code paths to test rather than one.** They already exist; TESTING.md §3.3 covers all
  three on the same fixture.

## Consequences

- Assumption A9 is struck through in [ARCHITECTURE.md §0](../ARCHITECTURE.md) and points here, the
  same treatment A8 received.
- [FINANCIAL-ENGINE.md §3.1](../FINANCIAL-ENGINE.md) keeps `'greater'` as the documented default and
  cites this ADR; S1 records that it supersedes A9.
- The breakdown returned by `calculateSafeDailyLimit` names which basis produced the income line, so
  the UI can explain "we used the ₹72,000 you actually received, not the ₹60,000 you planned".
- Revisiting this is a product decision with a written home, not a preference to be re-argued in a
  PR comment.
