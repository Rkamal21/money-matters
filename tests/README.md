# `tests/` — the suites that do not live beside the code

Unit and component tests are co-located with what they test (`src/**/*.test.ts`,
`src/**/*.test.tsx`) so a module and its test move together. What lives here is everything that
needs a harness of its own.

| Directory      | Runner                              | Needs          | Proves                                                                                    |
| -------------- | ----------------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `unit/`        | Vitest (`unit` project)             | nothing        | Cross-cutting rules that belong to no single module — currently the lint rules themselves |
| `component/`   | Vitest (`component` project, jsdom) | MSW            | A component's real hooks and error mapping, without a database                            |
| `integration/` | Vitest (`integration` project)      | local Supabase | Migrations apply from zero; the SECURITY.md §8.2 schema assertions hold                   |
| `rls/`         | Vitest (`integration` project)      | local Supabase | The cross-tenant isolation matrix (TESTING.md §4.1). Lands in M1 with the first table     |
| `e2e/`         | Playwright                          | a built app    | The critical journey, at a mobile viewport, in a real browser                             |
| `setup/`       | —                                   | —              | Harness wiring; see its own README                                                        |

`npm test` runs unit + component only, so the common loop needs no Docker.
`npm run test:integration` is separate and deliberate.

Test data follows TESTING.md §9: factories rather than fixtures, an injected clock rather than the
wall clock, a seeded RNG for property tests, and never production data in any form.
