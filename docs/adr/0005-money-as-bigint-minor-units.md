# ADR-0005 — Money as `bigint` minor units with an in-house `Money` type

Status: **Proposed** · Date: 2026-09-07

## Context

v1 stored `DECIMAL(10,2)`, which `supabase-js` returns as a string, which the code passed through
`Number()` — so every displayed total was the result of binary floating-point arithmetic. It also
capped any amount at ₹99,999,999.99, and stored no currency anywhere.

## Decision

`bigint` minor units (paise) in PostgreSQL and in TypeScript, with an in-house `Money` value object
carrying its currency. Range constrained to ±9 × 10^14 minor units. `number` is structurally
prevented from entering money arithmetic by branding `Money` and converting only in the repository
layer.

## Alternatives

1. **`numeric(14,2)`** with a decimal library (decimal.js, big.js) in the client.
2. **dinero.js v2** — a well-regarded money library, immutable, `bigint`-capable.
3. **`double precision`** — v1's Android code did this.
4. **PostgreSQL `money` type.**

## Reasoning

Option 3 is disqualified: `0.1 + 0.2 ≠ 0.3` in a ledger is not a tradeoff. Option 4 is
locale-dependent and currency-unaware.

Option 1 is exact in the database but PostgREST returns `numeric` as a *string*, and the
overwhelmingly common client bug is `parseFloat()` on that string — which is precisely the v1 bug.
It moves risk from the database, where it was never a problem, into the client, where it is.

Option 2 is genuinely good and is the path if this decision is revisited. Rejecting it now is a
"no unnecessary dependencies" call, not a quality judgement: we have one currency with two decimal
places, and ~150 lines of `bigint` arithmetic is cheaper to own than a dependency's rounding
semantics are to learn. **Reconsider dinero.js when multi-currency arrives.**

`bigint` makes the whole class of float bugs unrepresentable rather than merely avoided.

## Tradeoffs

- **A conversion at every boundary.** Deliberate: it is visible, in one place, and asserted
  (`Number.isSafeInteger`).
- **`bigint` does not serialise to JSON natively.** The wire format is a JSON integer and the
  mapper converts; the range constraint keeps every value inside `Number.MAX_SAFE_INTEGER`.
- **Multi-currency needs work later** — an FX rate table and rate-dependent aggregates. The
  currency column exists from day one so the schema does not change.

## Consequences

- No `float`, `real`, or `double precision` column exists anywhere in the schema.
- `Money` owns rounding: `divideFloor` returns a remainder, `allocate` uses largest-remainder.
- A `CHECK (abs(amount_minor) < 900000000000000)` backs the safe-integer guarantee at the database.
  Written as an integer literal, not `9e14`: the latter is `double precision` in PostgreSQL, so the
  comparison would round-trip a `bigint` through floating point — in a constraint whose entire
  purpose is to keep money out of floats.
