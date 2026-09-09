# ADR-0002 — TypeScript with `strict` everywhere

Status: **Proposed** · Date: 2026-09-07

## Context

v1 is plain JavaScript. Two of its shipped bugs are ones a type system catches at the boundary:

- `isToday(isoDate)` compared a UTC date string against a `timestamptz` string, because both are
  `string` and nothing distinguished "civil date" from "instant".
- `Number(data.amount)` turned a `DECIMAL` into a float, because both are `number` and nothing
  distinguished "money" from "quantity".

This application's core types are money, dates, and ownership. All three look like primitives and
are not.

## Decision

TypeScript 5.x with `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
and `noImplicitOverride`. Branded types for `Money`, `LocalDate`, and every entity id. No `any`; no
`@ts-expect-error` without a linked issue.

## Alternatives

1. **Plain JavaScript with JSDoc types** — type checking without changing the build.
2. **TypeScript without `strict`** — gradual adoption.
3. **Plain JavaScript plus runtime validation only** (Zod at every boundary).

## Reasoning

Option 3 is necessary regardless — untrusted input needs runtime validation — but insufficient: it
catches bad *data*, not bad *code*. `Money.add(salary, daysRemaining)` is a type error, not a data
error, and no amount of Zod will find it.

Option 2 is the worst of both: the ceremony of types with none of the guarantees. `strictNullChecks`
alone is most of the value, and it is not optional in a codebase where "no budget set yet" is a real
state on every screen.

Branded types are the specific mechanism that matters: they make `calculateSafeDailyLimit(income:
number)` impossible to call with a raw number, which is how "never use floats for money" becomes
structural rather than aspirational.

## Tradeoffs

- Slower to write, especially at the Supabase boundary where generated types are verbose.
- `bigint` and branded types add friction at every conversion — which is the point. The friction
  sits at the boundary, where a conversion should be visible.
- Generated database types must be regenerated on every schema change (CI-enforced).

## Consequences

- `tsc --noEmit` runs in CI and blocks merge.
- `src/data/supabase/database.types.ts` is generated and committed.
- Domain functions take one input object and return one result object, so adding a field never
  breaks a call site.
