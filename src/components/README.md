# `components/` — shared, feature-agnostic UI

The rule that keeps this folder from becoming v1's junk drawer: a component moves here from
`features/x/components/` the **second** time a different feature needs it — never in anticipation.

- `ui/` — the design system primitives (`Button`, `Input`, `Card`, `Dialog`, `Money`, …), built on
  vendored Radix primitives ([ADR-0014](../../docs/adr/0014-radix-primitives-vendored.md)).
- `charts/` — `CategoryDonut`, `MonthlyBars`, `GoalProgressBar`.

Components may depend on `domain/`, `hooks/` and `lib/`. They may **not** import a feature, and they
may not import the Supabase client.

**Milestone 0 state:** empty. `<Field>`, `<Input>`, `<Button>` and `<Card>` land in M1 with the auth
forms that need them.
