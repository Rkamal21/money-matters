# ADR-0016 — Gamification as an append-only event ledger, XP server-awarded only

Status: **Proposed** · Date: 2026-09-07

## Context

v1 stored `profiles.xp`, `profiles.level`, `profiles.streak`, and `profiles.last_activity_date`,
all updated by `useProfile.addXpAndUpdateStreak()` — a client-side function that computed the new
values and wrote them. Three consequences:

```js
supabase.from('profiles').update({ xp: 999999, level: 100 }).eq('id', me)   // works
```

XP and level could disagree with each other; there was no record of why anyone had the XP they had;
and the streak comparison used a UTC date string, so it broke for IST users overnight.

## Decision

- `gamification_events` is an **append-only ledger** with `UNIQUE (user_id, dedupe_key)`.
- `gamification_profiles.xp_total` is a cache maintained only by `award_xp()`, a
  `SECURITY DEFINER` function. The `authenticated` role has **`SELECT` only** on both tables.
- **`level` is not stored.** It is `floor(xp_total / 100) + 1`, a pure function.
- Streak transitions are computed in SQL by `daily_check_in()`, which clamps the increment to at
  most one and rejects a `p_today` outside a narrow window around the server's date.

## Alternatives

1. **Keep it client-computed** and accept that XP is cosmetic and cheatable.
2. **Server-computed but stored as a single counter**, no event ledger.
3. **A full event-sourced gamification service.**

## Reasoning

Option 1 is defensible for a pure game. It is not defensible in a finance app, where the same
`profiles` table holds settings that *do* matter, and where "the numbers in this app can be edited
from the console" is a fact users can discover and generalise. Trust is the product.

Option 2 gives correctness but no auditability: when a rule is wrong — and gamification rules are
tuned repeatedly — there is no way to recompute totals or explain a user's XP. The ledger makes both
trivial and costs one small append-only table.

Option 3 is over-engineering for eight event types.

The `dedupe_key` is the mechanism that makes the whole thing safe: `check_in:2026-09-07`,
`tx:<uuid>`. Retrying a request, double-tapping, or replaying a captured call collides on the key
and awards nothing. **XP is idempotent by construction**, not by client discipline.

## Tradeoffs

- **XP awards require a server round trip** (a trigger or an RPC), so the UI predicts optimistically
  and reconciles. Acceptable — the domain functions that predict are the same rules, mirrored in
  SQL, and a mismatch is a test failure.
- **Rules exist in two places** (a TypeScript config for prediction, `award_xp` calls in SQL for
  truth). The nearest thing in the design to duplicated logic. Bounded by keeping the catalog tiny
  and testing that the two agree.
- **An extra table** and an extra write per XP event. Negligible.

## Consequences

- No client-callable path grants XP, at all. In particular there is no
  `record_gamification_event(p_type, p_dedupe_key)` RPC — an earlier draft of
  [ARCHITECTURE.md §I.2](../ARCHITECTURE.md) listed one, and a client able to supply its own event
  type and dedupe key could have minted XP for events that never happened. `award_xp` is internal
  and carries no grant.
- **The tables and `award_xp()` are created in Milestone 1, not Milestone 9.** `handle_new_user()`
  writes a `gamification_profiles` row on signup, so the schema must exist well before any
  gamification surface does. M9 adds the product and the awards: the XP display, streaks, the
  check-in RPC, `on_transaction_awards_xp()` — which also awards goal contributions and goal
  achievement, since a contribution is a transfer
  ([ADR-0026](./0026-goals-are-the-purpose-of-a-wallet.md)) — and the achievement catalog. Nothing
  user-visible ships earlier.
- `award_xp` is `SECURITY DEFINER` owned by a role holding `BYPASSRLS`, because
  `gamification_events` and `gamification_profiles` have no write policy at all
  ([ADR-0020](./0020-rls-execution-model.md)).
- `recompute_xp_totals()` is the repair path this ADR's "totals can be recomputed" claim always
  implied, and it is now a named function rather than an aspiration.
- Daily caps (5 transaction awards per day, one check-in) live in `award_xp`, so farming is stopped
  server-side.
- `profiles.gamification_enabled = false` is honoured *in the function*, not just in the UI.
- The XP history screen exists because the ledger exists: a user can see exactly why they have the
  XP they have.
