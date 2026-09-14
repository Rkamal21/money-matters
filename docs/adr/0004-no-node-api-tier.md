# ADR-0004 — No Node/Express API tier; Edge Functions only where a secret is needed

Status: **Proposed** · Date: 2026-09-07

## Context

The instinct on seeing "the browser talks to the database" is to add a server in between. It is
worth writing down why we are not doing that, because someone will propose it, reasonably, in
month three.

## Decision

No persistent application server. The client uses PostgREST for CRUD and RPCs for transactional
operations. Supabase Edge Functions (Deno) are used **only** where an operation needs a secret the
client must not hold, or a network call the client must not make: account deletion (`service_role`),
future AI insights (model API key), future bank integrations.

## Alternatives

1. **Node/Express in front of Supabase** for all writes.
2. **BFF pattern** — a thin server shaping responses for the client.
3. **Edge Functions for everything**, PostgREST for nothing.

## Reasoning

A CRUD API tier in front of Supabase would: duplicate the authorization rules RLS already enforces,
in a second place that can drift; add a deployment, a scaling concern, and ~80 ms per call; and
still not be able to keep anything secret from the user, because the data *is* the user's.

The reflex behind option 1 is usually "the client should not be trusted" — correct, and already
addressed. The client is not trusted; PostgreSQL enforces every rule. An API tier does not add trust,
it adds a place to forget a check.

Option 3 turns every read into a hand-written function with hand-written filtering and pagination,
which is what PostgREST already does correctly.

## Tradeoffs

- **No server-side business logic.** Multi-step operations must be SQL functions, which means some
  logic is written in PL/pgSQL rather than TypeScript. Accepted: those operations need to be
  transactional anyway, and a transaction is a database concept.
- **No place to hide a rule from the user.** Not needed for a personal finance app; would be needed
  for anything involving other people's money or pricing.
- **Rate limiting is coarse** (gateway-level, per-IP). Recorded as a known gap in SECURITY.md §6.

## Consequences

- Complex reads are RPCs returning aggregates, not row dumps.
- Feature code depends on repository *interfaces*, so if this decision is reversed,
  `SupabaseTransactionRepository` is replaced by `HttpTransactionRepository` and nothing above the
  data layer changes.
- Edge Functions stay a short, justified list. Each new one needs a reason in its PR description.
