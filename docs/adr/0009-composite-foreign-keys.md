# ADR-0009 — Composite foreign keys `(id, user_id)` for cross-tenant integrity

Status: **Proposed** · Date: 2026-09-07

## Context

RLS stops a user *reading* another user's rows. It does not stop them *referencing* one. With a
plain `category_id uuid references categories(id)`, user A can insert a transaction with
`user_id = A` (passing the `WITH CHECK`) and `category_id` belonging to B. The insert succeeds: the
foreign key checks only that the row *exists*, and B's `SELECT` policy is never consulted. A now
holds a row pointing into B's data, and B cannot delete that category for reasons B cannot see.

This is not theoretical — it is the default outcome of the most natural schema you would write.

## Decision

Every referenceable table carries `UNIQUE (id, user_id)`, and every cross-table reference is
composite:

```sql
foreign key (account_id, user_id) references public.accounts (id, user_id)
```

Applied to ten references across transactions, splits, budget limits, goals, and the category
self-reference. The goal's reference to its wallet also carries the account type, so the same FK
asserts "must be a wallet" as well as ownership ([ADR-0026](./0026-goals-are-the-purpose-of-a-wallet.md)).

## Alternatives

1. **Plain FKs + trust RLS.**
2. **Plain FKs + a `BEFORE INSERT` trigger** checking ownership of each referenced row.
3. **Plain FKs + validation in a `SECURITY DEFINER` RPC** for every write.

## Reasoning

Option 1 has the hole described above.

Option 2 works but is per-table hand-written code that must be remembered for every new reference,
runs per row, and can be got subtly wrong. A foreign key cannot be got wrong: it is declarative,
enforced by the storage layer, and impossible to bypass.

Option 3 forces every write through an RPC, losing PostgREST's generated CRUD for no additional
guarantee.

The composite FK moves the check *below* every other layer. It holds even if a policy is
misconfigured, even if a trigger is dropped, and even if a future developer writes a raw
`service_role` script — which is exactly when you want a guarantee to hold.

## Tradeoffs

- **One extra unique index per table.** Small storage and write cost; the index is also useful for
  the ownership lookups the policies perform.
- **Unusual DDL** that a new developer will not recognise. Hence this ADR and the explanation in
  DATABASE.md §7.
- **`user_id` is denormalised onto child tables** (a split's user is derivable from its
  transaction). Deliberate: it is what makes both RLS and the composite FK possible, it is
  immutable, and it is excluded from the UPDATE grant so it cannot drift.

## Consequences

- Every new table needs `user_id`, `UNIQUE (id, user_id)`, and composite FKs. It is on the
  Definition of Done checklist.
- The RLS test matrix asserts a cross-user reference fails with `23503`.
