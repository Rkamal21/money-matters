# `features/` — vertical slices

A feature owns its UI, its hooks, its Zod schemas, its services and its routes. A developer working
on goals touches `features/goals/`, `domain/goals/`, `data/repositories/Goal*` and one migration —
that is the unit of parallel work ([ARCHITECTURE.md §N](../../docs/ARCHITECTURE.md)).

```
features/<name>/
  components/   presentation
  hooks/        application layer: validate -> repo -> map errors -> invalidate
  services/     multi-step orchestration, unit-testable with fake repositories
  schemas/      Zod, for UX validation (the database owns truth)
  routes/       page components
```

Rules a feature may not break, all lint-enforced:

- **No arithmetic on money or dates.** That lives in `domain/`. A `(income - fixed) / 30` in a
  component fails lint, not review — but read the caveat below before trusting that.
- **No `data/supabase/client` import.** Use a repository interface.
- **No cross-feature imports.** If two features need the same thing it moves down a layer, into
  `domain/`, `components/ui/` or `lib/`.

## The money-arithmetic rule is a guardrail, not a proof

The lint rule that rejects `(income - fixed) / 30` matches **identifier names**, not meaning
([ADR-0024](../../docs/adr/0024-money-arithmetic-lint-is-a-heuristic.md)). It knows about thirty-odd
money and period words; it does not know what your code does.

|                   |                                                                                |
| ----------------- | ------------------------------------------------------------------------------ |
| **Catches**       | the canonical mistake, and anything spelled with a name on the list            |
| **Misses**        | the same calculation under other names — `const perHead = pot / people` passes |
| **Over-fires on** | ordinary arithmetic in its scope, e.g. `total / count` in a chart              |

Two consequences for you:

1. **A green lint is not evidence the layering held.** Reviewers still read diffs for calculations
   that moved up a layer — that is the rule ARCHITECTURE.md §F.4 describes, and it is still on.
2. **`// eslint-disable-next-line no-restricted-syntax` with a reason is a fine answer** when the
   rule is wrong about your line. Write the reason; it is what the reviewer reads.

From Milestone 2 the type system does most of this work: `Money` is a value object with methods and
no operators ([ADR-0005](../../docs/adr/0005-money-as-bigint-minor-units.md)), so `income - fixed`
will not compile.

**Milestone 0 state:** empty. `auth`, `onboarding` and `settings/profile` land in M1.
