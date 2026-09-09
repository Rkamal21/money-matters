# ADR-0015 — SMS ingestion is optional and policy-gated; fallbacks ranked

Status: **Proposed** · Date: 2026-09-07

## Context

Automatic transaction capture from bank SMS is the feature most likely to make this product
genuinely differentiated in India, where UPI and card SMS are near-universal. v1 already contains a
partial implementation: a `SmsTransactionReceiver`, a regex analyser, a Room database, and a
`RECEIVE_SMS` permission in the manifest.

That implementation logs complete bank SMS bodies to Logcat, stores complete bodies in an
unencrypted local database, exports the receiver without sender validation, and is wired to nothing.
The permission is declared with no Play Console declaration filed.

`RECEIVE_SMS` is a Google Play **restricted** permission. Apps requesting it must be the default SMS
handler or hold an approved exception. An app declaring it for an unimplemented feature can be
rejected outright.

## Decision

1. **Remove `RECEIVE_SMS`, the receiver, and the Room storage in Milestone 0.** The parser regexes
   are preserved here and in the Milestone 12 notes as reference material.
2. **Treat SMS ingestion as optional and non-blocking.** The core product must never depend on it,
   and must be fully usable if the permission is denied.
3. **File the Play Console declaration before building it**, at the start of Milestone 12, and wait
   for an answer.
4. **Rank the fallbacks** so a refusal is a re-plan, not a crisis:
   1. User-initiated **CSV / bank statement import** — no permission, identical downstream pipeline.
   2. **Notification-listener** parsing — a different policy surface, still restricted, less certain.
   3. **Account Aggregator** (India's RBI-regulated consented data framework) — the correct
      long-term answer, higher integration cost, requires an AA partnership.

## Alternatives

1. **Build it now and ask forgiveness.** Risks store rejection of the whole app.
2. **Skip it permanently**, manual entry only. Gives up the strongest differentiator.
3. **Make it the headline feature** and design the product around it. Bets the roadmap on someone
   else's approval decision.

## Reasoning

The architecture already absorbs this uncertainty at zero cost: *any* ingestion source writes to
`transactions` with a `source` and `status = 'pending_review'`. The parser is a source adapter
behind an interface. Whether the bytes arrive from an SMS, a CSV row, or a bank API changes one
adapter and nothing else. That is the whole reason `source`, `status`, `dedupe_hash`, and
`external_ref` exist in the schema from Milestone 2 — and Milestone 12 is the test of whether that
extension point was real.

Keeping a restricted permission in the manifest for an unbuilt feature is pure downside: it cannot
help, and it can block a release.

## Tradeoffs

- **Manual entry only until at least Milestone 12.** Mitigated by making entry genuinely fast
  (under 10 seconds, one-handed) — which is required anyway.
- **Deleting working parser code** feels wasteful. It is ~120 lines of regex, preserved in this ADR
  and rewritten with tests when it is actually needed.

## Consequences

- Milestone 0 removes the permission, the receiver, the Room entities, and the DAO.
- Milestone 12 is explicitly gated on a policy answer and has a named fallback.
- Privacy constraints for any future implementation are binding and listed in SECURITY.md §9:
  never log the body, never store the body, never transmit the body, encrypt the local queue,
  require `BROADCAST_SMS` on the receiver, allow-list senders, and never auto-confirm a parse.
