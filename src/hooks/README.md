# `hooks/` — cross-cutting hooks only

`useMediaQuery`, `useDebounce`, `useLocalStorage`, `useReducedMotion`. Nothing that knows about a
feature, an entity or a query key — a hook that mentions "transaction" belongs in
`features/transactions/hooks/`.

**Milestone 0 state:** empty.
