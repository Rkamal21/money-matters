# ADR-0006 — `occurred_on date` + user timezone, not `timestamptz`, for transaction dates

Status: **Proposed** · Date: 2026-09-07

## Context

v1 stored `expenses.date` as `timestamptz` and computed "today" as
`new Date().toISOString().slice(0,10)` — the **UTC** date. For a user in `Asia/Kolkata` (UTC+5:30),
between 00:00 and 05:30 local, "today" was yesterday. That is 23% of every day, and it silently
corrupted both the "today's spend" tile and the streak counter, with no error and no way for a user
to tell.

## Decision

Two separate concepts, two separate types:

- `occurred_on date` — the user's civil calendar day. What a person means by "when I spent it".
- `created_at timestamptz` — the instant the row was written. System metadata.

They are never compared. `profiles.timezone` holds an IANA zone. The **client** computes
`today = LocalDate.fromInstant(now, tz)` once, in `domain/period`, and sends that `date`.

## Alternatives

1. **`timestamptz` everywhere**, converting at read time using the user's zone.
2. **`timestamp without time zone`** in the user's local zone.
3. **Store both** the instant and the civil date, always.

## Reasoning

Option 1 keeps the conversion, and therefore the bug, alive at every read site: every query, every
aggregate, every `GROUP BY` must remember to apply the zone. One that forgets is wrong and silent.

Option 2 stores a value whose meaning depends on knowledge held elsewhere — the worst property a
column can have.

A `date` has no instant, so it cannot be converted wrongly. "I spent ₹450 on 7 September" is true
regardless of where the user is standing when they read it. The instant of an in-person purchase is
not information the product needs, and pretending to know it invites the conversion bug back.

`occurred_at timestamptz` remains available as *optional* metadata for ingested transactions where a
bank supplied a precise time — informational only, never used for bucketing.

## Tradeoffs

- **A user who travels** sees dates in the zone they recorded them, not the local zone. Correct: the
  transaction happened on that day.
- **Changing the profile timezone** shifts future period boundaries but does not rewrite stored
  dates. Documented in the UI; the alternative — rewriting the user's history — is worse.
- **Sub-day ordering** within a date falls back to `created_at`. Acceptable for manual entry.

## Consequences

- `domain/period/LocalDate` has no `Date` inside it; arithmetic is calendar arithmetic, so DST
  cannot affect it.
- `LocalDate.fromInstant` is the single conversion point in the system, implemented with
  `Intl.DateTimeFormat(...).formatToParts()`, never string slicing.
- `new Date()` and `Date.now()` are lint-banned in `src/domain/**`.
- The date test suite runs in three timezones in CI.
