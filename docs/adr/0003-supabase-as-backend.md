# ADR-0003 — Supabase as the backend; PostgreSQL as the application server

Status: **Proposed** · Date: 2026-09-07

## Context

We need relational integrity, authentication, and per-user data isolation, with a team of 2–5 and
nobody available to run servers. The data is financial: cross-tenant leakage is the worst outcome
in the system, and referential integrity between transactions, accounts, categories, budgets, and
goals is not optional.

## Decision

Supabase — PostgreSQL 15+, GoTrue auth, PostgREST, Edge Functions, RLS. The browser talks to
PostgREST directly with the user's JWT. **PostgreSQL is the application server:** RLS is the
authorization layer, constraints and triggers are the validation layer, `SECURITY DEFINER`
functions are the transactional service layer.

## Alternatives

1. **Firebase / Firestore** — managed, real-time, familiar.
2. **Neon or RDS + a custom API tier** — full control.
3. **Self-hosted PostgreSQL + PostgREST** — the same architecture without the vendor.
4. **Convex / Appwrite / PocketBase** — other batteries-included backends.

## Reasoning

Firestore is disqualified by the data model, not by preference: no joins, no `CHECK` constraints, no
foreign keys, no `EXCLUDE` constraints, no transactional multi-row aggregates. "A transfer's two
legs are consistent" and "a split sums to its parent" are not expressible. Its security rules are
also materially weaker than RLS for relational ownership — the composite-FK technique in ADR-0009
has no Firestore equivalent.

Option 2 is the honest runner-up. It costs us an API tier to design, deploy, secure, and keep in
sync with the schema — and that tier would re-implement the authorization RLS already gives us, in
a second place that can disagree with the first.

Option 3 is the same architecture with an operations bill. We can move to it later precisely
because the schema is plain SQL.

RLS is the single most valuable property here: "user A cannot read user B's money" becomes a
database-enforced fact rather than an application concern that one forgotten endpoint can break.

## Tradeoffs

- **Vendor coupling** is real but bounded. Portable: the schema, the migrations, the data, the
  domain layer. Coupled: RLS-as-authorization and GoTrue. Leaving means porting policies into an
  application authorization layer — a known, quantifiable cost, accepted knowingly.
- **No secrets from the client.** Anything the client can call, the client can inspect. Fine now;
  it is why AI insights need an Edge Function later.
- **PostgREST's query surface is fixed.** Complex reads become RPCs, which is where we wanted them.

## Consequences

- Every table needs explicit RLS and explicit grants. A forgotten policy is a breach, so it is
  CI-checked (see SECURITY.md §8.2).
- Multi-step writes become `SECURITY DEFINER` functions rather than orchestrated client calls.
- Repository interfaces (ADR-0004) are the escape hatch if this decision is ever reversed.
