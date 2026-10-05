# ADR-0024 — The money-arithmetic lint rule is a name-matching guardrail, not financial analysis

Status: **Accepted** · Date: 2026-09-09 · Reconciles
[ARCHITECTURE.md §F.4](../ARCHITECTURE.md) with the Milestone 0 acceptance criteria in
[ROADMAP.md](../ROADMAP.md) · Implemented in Milestone 0

## Context

Two approved documents describe what happens when someone puts `(income - fixed) / 30` in a
component, and they prescribe different mechanisms.

- **[ARCHITECTURE.md §F.4](../ARCHITECTURE.md)**: "If a PR puts `(income - fixed) / 30` in a
  component, **the reviewer catches it**. If a PR imports `supabase` into a component, **CI** catches
  it." Two sentences, deliberately contrasted: one rule is human, the other automated.
- **[ROADMAP.md](../ROADMAP.md)**, Milestone 0 acceptance criteria: "A PR that puts
  `(income - fixed) / 30` in a component **fails lint**, not review."

The second is an acceptance criterion — something Milestone 0 is measured against — so it wins on
precedence. But §F.4's framing is not wrong, and the reason it is not wrong matters: no linter can
decide whether an expression is a money calculation. `total / count` is an average; `x / 30` is
arithmetic. Meaning is not in the syntax tree.

Shipping the rule without saying so invites the failure this ADR exists to prevent: a future
developer sees a green lint, concludes the layering is mechanically guaranteed, and stops reading
diffs for the calculation that slipped through under a different variable name.

## Decision

**The rule ships, scoped to the presentation layers, and is documented everywhere it appears as a
heuristic guardrail rather than semantic analysis.**

`eslint.config.js` defines a `no-restricted-syntax` selector matching an arithmetic
`BinaryExpression` (`-`, `*`, `/`, `%`) with an operand — identifier or member property — whose
**name** is one of roughly thirty money and period terms (`income`, `fixed`, `amountMinor`,
`balance`, `spent`, `remaining`, `safeDailyLimit`, `daysRemaining`, …). It applies to
`src/features/**/components/`, `**/routes/`, `**/widgets/`, `src/components/**` and `src/app/**`.
It does not apply to `src/domain/**`, which is where that arithmetic belongs.

Three things follow, and all three are stated in the config, in `src/features/README.md`, and here:

1. **It matches names, not meaning.** It catches the canonical mistake and anything spelled like it.
   It does not catch the same calculation written with different variable names, and it never will.
2. **It is deliberately over-broad within its scope.** `total / count` in a component trips it. That
   is the intended bias: a false positive costs one comment; a false negative ships wrong money to a
   user.
3. **A justified `eslint-disable-next-line` is a legitimate outcome**, and reviewing that comment is
   the review §F.4 describes. The escape hatch is the point at which the human rule resumes.

**Review remains responsible for the general rule.** This lint is a floor, not a ceiling.

## Alternatives

1. **Follow §F.4 literally: no lint rule, review only.** Fails ROADMAP's acceptance criterion.
2. **Ban all arithmetic operators in the presentation layers.** Mechanically complete within scope,
   no name list to maintain.
3. **Type-driven enforcement**: make `Money` a `bigint` branded type with no arithmetic operators, so
   `income - fixed` is a *type error* wherever it appears.
4. **A custom ESLint rule with type information**, flagging arithmetic whose operands are typed
   `Money` or `LocalDate`.

## Reasoning

Option 2 was tried and rejected on noise: `index + 1`, `width / 2`, `page * size` and every chart
coordinate would need a disable comment, and a rule that fires constantly is a rule people learn to
suppress without reading. Its precision is worse than the name list in practice, because the
disables stop being examined.

Option 3 is the real answer and it is already the plan — [ADR-0005](./0005-money-as-bigint-minor-units.md)
specifies `Money` as a value object with methods, not operators, so `income.minus(fixed)` is the
only way to write it and the raw form does not typecheck. **That lands in Milestone 2**, with
`domain/money/**`. When it does, this lint rule becomes a backstop for the pre-`Money` cases rather
than the primary defence.

Option 4 is the principled middle ground and is worth revisiting after M2, when there are `Money`
and `LocalDate` types for it to key on. Writing it in M0 would mean a custom rule keyed on types
that do not exist yet.

So: the name list is the M0-appropriate instrument. It is honest about what it does, it costs
nothing, and it is superseded by construction rather than by deletion.

## Tradeoffs

- **A calculation under other names ships silently.** `const perHead = pot / people` passes. This is
  the accepted limit, and the reason review is still on the hook.
- **The name list needs occasional maintenance.** It is one array in `eslint.config.js`. If it grows
  past a screen, that is the signal to build option 4.
- **False positives in charts and layout code.** Expected; the disable comment carries the reason.

## Consequences

- `eslint.config.js` carries `MONEY_IDENTIFIERS` and a comment stating this is a heuristic.
- `src/features/README.md` states the rule and its limit, so a developer meets it before CI does.
- `tests/unit/architecture-rules.test.ts` asserts the rule fires in a feature component and in a
  shared component, and **does not** fire inside `domain/` — so a scope change that silently
  disables it fails a test.
- ARCHITECTURE.md §F.4 is not amended: its statement that review catches this remains true, and is
  now the documented complement to the lint rather than an alternative to it.
- **Revisit after Milestone 2.** Once `Money` exists, option 3 does most of this work in the type
  system, and this rule should shrink to the cases types cannot reach.
