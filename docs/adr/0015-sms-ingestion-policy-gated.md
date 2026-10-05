# ADR-0015 — SMS ingestion is optional and policy-gated; fallbacks ranked

Status: **Proposed**, amended 2026-10-04 · Date: 2026-09-07

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

## Amendment — 2026-10-04: built, and automatic

At the owner's direction Milestone 12 was **built before the Play Console declaration was filed**
(decision 3 above). The declaration is still required before any release that contains the
permissions; if it is refused, the fallbacks below stand and the feature ships disabled.

The owner also asked that expenses not need typing at all, and chose:

1. **Clear detections are added automatically.** "Never auto-confirm a parse" becomes "never add an
   *uncertain* parse on its own". A detection is added without a tap only when nothing needs a
   person: type, amount in the ledger currency, payee, a category from a rule at ≥ 0.9 confidence
   (the form's own pre-fill threshold), a date, and an account — the one whose last digits the
   message shows, or the user's only bank account — are all certain, and the ledger holds nothing
   with the same amount and type within a day (a typed entry, a repeat) and no opposite movement of
   the same amount on another account within two days (half of an own-account transfer). The rules
   are one pure module (`domain/transactions/ingest/autoAdd.ts`). Safeguards: the write is the
   entry form's own `saveTransaction`, idempotent on a key derived from the message; the
   notification says "added" and offers **Undo**; a switch turns it off; everything else waits for
   review, where confirming teaches the payee's category so its next payment is clear.
2. **Payment-app notifications are a second source**, not a fallback — several banks no longer send
   SMS for small UPI payments. A notification listener reads only an allow-list of payment and bank
   apps, behind its own disclosure. One payment's SMS and notification are paired and kept once.
3. **Past messages can be imported** once, with `READ_SMS` (covered by the same SMS-based money
   management declaration), behind its own disclosure. An imported payment older than its account
   is absorbed into the opening balance by `record_transaction_origin`, atomically, so today's
   balance stays what the user entered.

Detections wait in an encrypted on-device queue and reach the ledger only as ordinary confirmed
inserts; `pending_review` rows, `dedupe_hash` and `record_transaction_review` turned out not to be
needed. Unconfirmed financial data never leaves the phone. `transactions.source` now records
provenance (`sms`, `notification`, `import`). The ledger write needs the app running: a message
that arrives while it is closed is queued and notified, and added the moment the app opens —
native code would need the user's session, and sharing its rotating refresh token risks signing
them out.
