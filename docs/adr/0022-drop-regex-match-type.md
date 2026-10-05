# ADR-0022 — `regex` dropped from the merchant-rule `match_type` enum

Status: **Accepted** · Date: 2026-09-08 · Actions the recommendation in
[ARCHITECTURE.md §R.6 / §R.16 item 10](../ARCHITECTURE.md)

## Context

`merchant_rules.match_type` was specified as `enum ('contains','prefix','exact','regex')`.
The architectural self-review flagged the fourth value as over-engineered and recommended removing
it — and then nothing happened: the enum, the column documentation, and threat T17's mitigations
all still carried `regex` three documents later. A recommendation that no document acts on is
indistinguishable from a decision to keep it.

Two properties make this worth deciding now rather than at Milestone 3:

- **Enum values are asymmetric.** `ALTER TYPE … ADD VALUE` is one line. *Removing* a value once rows
  reference it means creating a new type, rewriting every dependent column, and dropping the old
  one. The cheap moment is before the first migration exists.
- **`regex` is the only ReDoS surface in the system** (threat T17). `merchant_rules` is also the
  only table shared between users, so it is the one place a user-authored pattern could later be
  evaluated in a context that is not their own browser — for instance when server-side matching
  arrives with SMS ingestion in M12.

## Decision

**`match_type` is `enum ('contains','prefix','exact')`.** No `regex` matching is implemented.
Reintroducing it requires a new ADR that supersedes this one.

## Alternatives

1. **Keep `regex`** with T17's mitigations: a 100-character pattern cap, client-side-only matching
   at MVP, and a commitment to an RE2-style engine plus `statement_timeout` before any server-side
   evaluation.
2. **Keep the enum value, refuse it in the application layer** — schema ready, feature disabled.

## Reasoning

Option 1 is a real cost for a benefit nobody has asked for. Every rule in the Milestone 3 test
fixtures — `UPI/SWIGGY/423512/PAYTM`, `AMAZON PAY INDIA PRI`, `UBER   INDIA SYSTEMS`,
`POS 1234 BIGBASKET BLR` — is matched by `contains` after normalisation. The self-review's own words
were "`contains`/`prefix`/`exact` cover every real rule, and `regex` adds a ReDoS surface for one
power user".

Option 2 is the worst of both: the value exists, so a future developer can reach it, but nothing
enforces the refusal at the storage layer. A `CHECK` forbidding a value the enum allows is a
constraint that exists only to apologise for the enum.

Removing the value retires T17 outright rather than mitigating it — a threat that cannot be
expressed does not need a `statement_timeout`, a safe engine, or a line in the threat model that
someone has to keep true.

The pattern-length cap stays regardless, so any future reintroduction starts from a bounded input.

## Tradeoffs

- **A power user cannot write a precise rule** for a merchant string that `contains` matches too
  broadly. The escape hatch is priority ordering plus a more specific `contains` pattern; the real
  answer, if it becomes a real complaint, is the ML/AI provider behind the same
  `CategorizationProvider` interface, not a regex box.
- **We may add it back.** That is the expected outcome if anyone asks, and it costs one migration
  line plus the mitigations in option 1. This ADR exists so that reintroduction is a decision with
  a recorded starting point, not a quiet enum edit.

## Consequences

- [DATABASE.md §5](../DATABASE.md) creates the three-value enum; §6.10 no longer describes a ReDoS
  surface.
- Threat **T17** in [SECURITY.md §5](../SECURITY.md) is struck through and marked eliminated rather
  than mitigated, with its mitigations preserved in the row so a reintroduction inherits them.
- `merchant_rules.pattern` keeps its 100-character cap.
- [ARCHITECTURE.md §R.6 and §R.16](../ARCHITECTURE.md) record the recommendation as actioned.
