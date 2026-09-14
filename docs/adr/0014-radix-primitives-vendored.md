# ADR-0014 — Radix primitives vendored, not a component library

Status: **Proposed** · Date: 2026-09-07

## Context

We need dialogs, selects, tabs, popovers, tooltips, and toasts. Accessibility is an architectural
requirement, not a cleanup task — and hand-rolled modals are where accessibility budgets die: focus
traps, focus restoration, `aria-modal`, escape handling, scroll locking, and roving tabindex are all
easy to get 80% right and 80% is unusable with a screen reader.

## Decision

Radix UI primitives, styled with Tailwind, with the component source **vendored** into
`src/components/ui/` (shadcn/ui style) rather than consumed as an installed component kit.

## Alternatives

1. **A full component library** — MUI, Chakra, Mantine, Ant.
2. **Headless UI** (Tailwind Labs).
3. **Hand-rolled components.**
4. **`npm install` a shadcn-style kit** rather than vendoring the source.

## Reasoning

Option 1 brings a large runtime, an opinionated visual identity that fights "trustworthy finance
product", and deep theming APIs we would spend more time overriding than using.

Option 2 is good but covers a smaller set of primitives.

Option 3 is how you ship an inaccessible product while believing otherwise.

Option 4 versus vendoring is the interesting comparison. Vendoring means the components are *our*
source: restyling is editing a file, not overriding a library; there is no upgrade that changes our
UI unexpectedly; and the diff of a component change is reviewable. The cost is that upstream fixes
must be pulled in manually — acceptable for a set of roughly fifteen components.

## Tradeoffs

- **We own the code.** Bugs are ours to fix. Upstream improvements are ours to port.
- **More initial work** than importing a kit — roughly a day per primitive to style and test.
- **Consistency is a discipline**, not a library guarantee. Mitigated by design tokens and the rule
  that a component moves into `components/ui/` only on its second consumer.

## Consequences

- `eslint-plugin-jsx-a11y` runs in CI; `axe-core` runs against key routes on every PR.
- Every input is rendered through a shared `<Field>` that wires `label`, `aria-describedby`, and
  `aria-invalid` — it is not possible to render an unlabelled input with our `Input`.
- Charts use Recharts (SVG, screen-reader-addressable) with a table fallback, not canvas.
