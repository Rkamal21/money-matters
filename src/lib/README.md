# `lib/` — framework glue

Small, dependency-light helpers that are not domain logic and not UI: `cn()`, the query-key factory,
the error presenter, the logger, and the Sentry setup.

`lib/observability/` is the Milestone 0 resident. [ARCHITECTURE.md §K](../../docs/ARCHITECTURE.md)
sets the rule it exists to enforce: **scrubbing is code, not policy**. `scrubEvent` runs an
allow-list over every Sentry payload, so a field nobody thought about is dropped rather than sent.

`console.log` is lint-banned across `src/` ([SECURITY.md §8.3](../../docs/SECURITY.md)); use the
logger.
