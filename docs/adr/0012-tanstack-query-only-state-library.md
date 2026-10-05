# ADR-0012 — TanStack Query as the only state library at MVP

Status: **Proposed** · Date: 2026-09-07

## Context

v1 hand-rolled server-state management five times: `useExpenses`, `useGoals`, `useBudget`,
`useProfile`, `useAuth`. Each has its own `useState` + `useEffect` + fetch + optimistic-update +
manual-revert logic, each subtly different, none with caching, deduplication, retry, or
invalidation. That code is where most of v1's complexity lives, and it is all accidental.

## Decision

TanStack Query v5 for **server state**. URL search params for **URL state**. `useState`/React Hook
Form for **local state**. Two small React contexts (`AuthProvider`, `PreferencesProvider`) for
genuinely global client state. **No Redux, no Zustand, no Jotai at MVP.**

## Alternatives

1. **Redux Toolkit + RTK Query.**
2. **Zustand** plus hand-rolled fetching.
3. **SWR** instead of TanStack Query.
4. **Keep hand-rolling** (v1).

## Reasoning

The critical observation is that most of what people call "app state" here is a *cache of remote
data*, and a cache needs staleness, deduplication, retry, background refetch, and invalidation —
exactly the feature list of TanStack Query. Once server state is in Query and filter state is in
the URL, the remaining global state is: one session object, one theme string, three preference
fields. Redux Toolkit for that is ceremony with no payoff; Zustand is 1 KB holding nothing.

SWR is smaller but has a materially weaker mutation and optimistic-update story, and optimistic
updates are the reason the transaction form feels instant.

## Tradeoffs

- **A dependency and a mental model** to learn. Paid back the first time an invalidation is one
  line instead of five refetches.
- **Query keys must be disciplined** or invalidation becomes guesswork. Mitigated by a central
  `lib/queryKeys.ts`, so "what does this mutation invalidate?" is greppable in one file.
- **Optimistic updates need rollback handling.** Query provides the mechanism; we provide the
  rollback per mutation.

## Consequences

- Defaults: `staleTime` 30 s, `gcTime` 5 min, `retry` 2 with exponential backoff,
  `refetchOnWindowFocus` true on web and false in the Capacitor shell (a WebView regains focus
  constantly).
- `queryClient.clear()` on sign-out — a cache of the previous user's balances on a shared device is
  a data-exposure bug.
- **When to revisit:** a multi-step flow whose draft must survive route changes — a guided budget
  wizard, or the SMS review queue — is a genuine reason to add a small Zustand store. That is a
  Milestone 12 question. Adding it then costs an afternoon; adding it now costs every developer a
  decision on every piece of state for a year.
