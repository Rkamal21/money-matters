# `domain/` — pure business logic

★ **PURE.** No React. No network. No Supabase. No `Date.now()`, `new Date()` or `Date.UTC` — time
enters through the `Clock` interface so every calculation is deterministic and testable in three
timezones.

`domain/` is a leaf: it imports nothing from the rest of the app. Enforced three ways in
`eslint.config.js` — the `boundaries` dependency policy, a `no-restricted-imports` ban on
`react`/`@supabase/*`/`@tanstack/*`, and `no-restricted-globals` on `Date`.

Target coverage is 100% ([TESTING.md §3](../../docs/TESTING.md)); these are the calculations that
decide what a user believes about their money.

**Milestone 0 state:** empty by design. Modules arrive with the milestone that needs them —
`money/` and `period/` in M2, `budget/` in M4, `goals/` in M6, `gamification/` in M9. See
[ARCHITECTURE.md §H](../../docs/ARCHITECTURE.md) for the full module list.
