# `app/` — composition root

Wires everything, owns nothing. Providers (Query, Auth, Theme, ErrorBoundary), the route table with
its lazy boundaries, and the two layout shells (`AppLayout`, `AuthLayout`).

This is the only place allowed to know about every other layer at once. It contains no business
logic and no data access of its own.

**Milestone 0 state:** `App.tsx` is a foundation shell only. `providers/` and `layouts/` are empty
placeholders — `AuthProvider` and `AuthLayout` land in M1 (auth), `QueryProvider` and `router.tsx`
land with the first routed feature in M1.
