# `tests/setup/` — harness wiring

One setup file per Vitest project, plus the shared pieces they compose.

| File                   | Used by       | Does                                                                                                        |
| ---------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `env.ts`               | all           | Stubs `VITE_*` so no test depends on a developer's `.env`, and so Sentry can never initialise in a test run |
| `unit.setup.ts`        | `unit`        | Configuration stubs only. Unit tests touch nothing else                                                     |
| `component.setup.ts`   | `component`   | jest-dom matchers, RTL cleanup, and the MSW server with `onUnhandledRequest: 'error'`                       |
| `integration.setup.ts` | `integration` | Asserts a local Supabase is actually running before a suite pretends to test RLS                            |
| `msw/`                 | `component`   | Request handlers. Thin by design — per-entity handlers land with the repositories they mock                 |
