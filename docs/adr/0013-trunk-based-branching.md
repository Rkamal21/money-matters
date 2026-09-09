# ADR-0013 — Trunk-based branching now; `release/*` from Milestone 11

Status: **Proposed** · Date: 2026-09-07

## Context

The project brief specifies `main ← develop ← feature/*`. This ADR records a deliberate departure
from it, so the departure is a decision rather than a drift.

## Decision

`main` plus short-lived branches (< 3 days). No `develop`. Squash merge. Preview deploy per PR.
Add `release/x.y` branches at Milestone 11, when the Android build begins.

## Alternatives

1. **GitFlow** (`main` ← `develop` ← `feature/*` ← `release/*` ← `hotfix/*`) — the brief's proposal.
2. **GitHub Flow** — what we are choosing.
3. **Release branches from day one.**

## Reasoning

`develop` earns its keep when there is a **release train**: a set of changes held back and shipped
together on a schedule. A continuously deployed web app has no train. `develop` then becomes a
branch that is merged to `main` periodically for no benefit, while doubling merge conflicts,
doubling CI cost, and creating the "works on develop, broken on main" drift that GitFlow was
invented to prevent in a world of quarterly releases.

With 2–5 developers, short branches, and a preview deploy on every PR, `main` plus feature branches
has fewer states to reason about and a faster path from written to deployed — which matters more at
this stage than release ceremony.

**This changes at Milestone 11**, and for a real reason arriving at a known time: a Play Store
binary *is* a release train. You cannot hotfix an APK the way you redeploy a web bundle, review
takes days, and users update on their own schedule. At that point `release/x.y` is cut from `main`
and fixes are cherry-picked back.

## Tradeoffs

- **`main` must always be deployable.** That is a discipline cost, paid by CI gates and squash
  merges rather than by a staging branch.
- **No natural integration branch** for a large multi-PR feature. Mitigated by feature flags and by
  interfaces-first PRs (CONTRIBUTING.md §5).
- **Departs from the brief**, which is why it is written down here rather than assumed.

## Consequences

- Two approvals for migrations, RLS, and `domain/money`; one otherwise.
- CI must be fast (~6 minutes) or short branches stop being short.
- Feature flags become the mechanism for shipping incomplete work, not long-lived branches.
