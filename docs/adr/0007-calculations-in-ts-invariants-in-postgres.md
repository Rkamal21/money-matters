# ADR-0007 — Calculations in TypeScript, invariants in PostgreSQL

Status: **Proposed** · Date: 2026-09-07

## Context

With no server tier, "where does business logic live?" has an ambiguous answer, and ambiguity here
produces either duplicated rules that drift or unguarded rules the client can bypass. v1 chose
badly in both directions: it computed in components *and* trusted the client to write derived state.

## Decision

Split business logic by **what it is**, not by where it is convenient:

- **Calculations** — safe daily limit, goal progress, level from XP, budget usage, savings rate.
  Pure functions of data the user already owns. They live in `src/domain/` as pure TypeScript.
- **Invariants** — goal progress equals the sum of its contributions; XP is only awarded for real
  events; an amount is positive; a category belongs to you. Rules the client must not be trusted
  to enforce. They live in PostgreSQL as constraints, triggers, grants, and RLS.

**Neither is duplicated in the other.** Where a value is both computed and stored
(`goals.saved_minor`), the ledger is the source of truth and a trigger maintains the column; the
client cannot write it at all.

## Alternatives

1. **All logic in the database** (PL/pgSQL functions for everything).
2. **All logic in TypeScript**, with the database as dumb storage.
3. **Duplicate the rules in both**, for defence in depth.

## Reasoning

Option 1 makes the safe daily limit a network round trip and makes it untestable without a database.
It is also the wrong place for something the user should see recalculated instantly as they type.

Option 2 is v1, and is how `xp = 999999` became a one-line browser exploit.

Option 3 sounds prudent and is the actual danger: two implementations of a financial rule *will*
diverge, and the divergence will be discovered by a user with wrong numbers. The exception —
deliberate and narrow — is *validation*: Zod validates for UX and a `CHECK` validates for truth.
That is the same rule expressed twice in two different forms at a trust boundary, which is defence
in depth, not duplicated logic.

## Tradeoffs

- **Calculations can be tampered with** by a determined user, on their own data, in their own
  browser. Nothing of ours depends on the output. Recorded so nobody "fixes" it later by moving
  arithmetic into RPCs.
- **Some logic is in PL/pgSQL**, a second language, with weaker tooling. Confined to a short list
  of functions, each integration-tested.

## Consequences

- `src/domain/` imports nothing from React, Supabase, or the network. Enforced by lint, not
  convention.
- Every authoritative value has no client write grant.
- A reviewer's first question on any PR: is this a calculation or an invariant?
