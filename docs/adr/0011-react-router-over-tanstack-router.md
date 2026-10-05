# ADR-0011 — React Router 7 over TanStack Router

Status: **Proposed** · Date: 2026-09-07

## Context

v1 had no router: `useState('home')` switched tabs. On Android that means the hardware back button
closes the app from any screen, filters cannot be shared or bookmarked, and a WebView reload loses
the user's place. We need real routing and URL-held state.

TanStack Router offers fully type-safe routes and, more importantly here, type-safe **search
params** — and our filter state lives in search params.

## Decision

React Router 7 (declarative mode), with a hand-written typed wrapper (`useTransactionFilters()`)
around `useSearchParams` that parses and serialises filters through a Zod schema.

## Alternatives

1. **TanStack Router** — end-to-end type safety including search params.
2. **Wouter** — 1.5 KB minimal router.
3. **No router**, keep tab state (v1).

## Reasoning

This is a close call and is recorded so it is not relitigated on vibes.

TanStack Router's search-param typing is genuinely better than what we get from a hand-written Zod
wrapper. Against it: React Router is the ecosystem default, every developer we hire knows it, its
documentation and Stack Overflow surface are an order of magnitude larger, and the Capacitor
back-button integration is well-trodden. The typed-search-param advantage is real but narrow, and
we recover most of it with ~40 lines of Zod in one file, which we would want anyway for validation
of untrusted URL input.

Option 2 is too minimal for nested layouts, modal routes, and route-level code splitting.

## Tradeoffs

- **Search params are typed by us**, not by the router — so the wrapper must be used consistently.
  A lint rule bans raw `useSearchParams` outside `features/*/hooks`.
- **Larger bundle** than Wouter by ~10 KB gzipped. Acceptable.
- **If routing-level type safety becomes a recurring pain**, migration to TanStack Router is a
  contained change: routes are declared in one file and features consume typed hooks.

## Consequences

- Filters, the selected period, pagination, and open modals live in the URL (see ARCHITECTURE.md
  §J). A filtered view is a shareable link and the back button behaves.
- Route-level lazy boundaries give us code splitting for analytics and charts.
- Capacitor's hardware back button maps to router history in Milestone 11.
