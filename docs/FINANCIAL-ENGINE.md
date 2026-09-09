# Money Matters 2.0 — Financial Calculation Engine

Status: **Proposed** · Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) · Date: 2026-09-07

Every number the user sees is produced by a function in this document. Each one is pure, lives in
`src/domain/`, takes an explicit input object, returns an explicit result object, imports nothing
from React or Supabase, and never calls `Date.now()`.

> **The rule that makes this testable:** time is a parameter. `today: LocalDate` is passed in, or a
> `Clock` port is injected. `new Date()` and `Date.now()` are banned inside `src/domain/**` by an
> ESLint `no-restricted-globals` rule. A calculation that reads the ambient clock cannot be tested
> for month boundaries, and month boundaries are where finance apps break.

---

## 1. Money

### 1.1 The `Money` value object

```ts
// domain/money/Money.ts
declare const brand: unique symbol;
export type Money = { readonly minor: bigint; readonly currency: CurrencyCode; readonly [brand]: 'Money' };

// construction
Money.fromMinor(250000n, 'INR')          // ₹2,500.00
Money.fromMajorString('2500.50', 'INR')  // parse-once at the input boundary
Money.zero('INR')

// arithmetic — all total, all exact, all currency-checked
add(a, b)  subtract(a, b)  negate(a)
multiplyByRatio(a, numerator: bigint, denominator: bigint)   // e.g. 30% of a budget
divideFloor(a, divisor: bigint): { quotient: Money; remainder: Money }
allocate(a, weights: bigint[]): Money[]   // largest-remainder; sums exactly to `a`
compare(a, b): -1 | 0 | 1
isZero  isNegative  isPositive  max  min  sumAll(list, currency)

// output
format(a, locale): string            // "₹2,500.50"
formatCompact(a, locale): string     // "₹2.5K" — charts and tight tiles only
toSpokenLabel(a, locale): string     // "two thousand five hundred rupees" for aria-label
```

Rules the type enforces rather than documents:

- **Mixing currencies throws.** It is a programmer error, not a user error, so it is an exception,
  not a `Result`. It cannot happen at MVP (one currency) and must not silently work later.
- **`number` cannot enter.** `Money` is branded; the only constructors take `bigint` or a validated
  string. The repository layer is the sole converter from a wire value, and it asserts
  `Number.isSafeInteger` first.
- **Division always returns the remainder.** `divideFloor` hands back `{ quotient, remainder }`
  so the caller must decide what happens to the leftover paise. Discarding it is then a visible
  choice, not an accident. This is what makes "₹12,000 over 20 days = ₹600/day with ₹0 left over"
  and "₹12,001 over 20 days = ₹600/day with ₹1 buffer" both truthful.
- **`allocate` never loses or invents a paisa.** Largest-remainder distribution: split ₹100 three
  ways and you get 3334 + 3333 + 3333 minor units, summing to exactly 10000.

### 1.2 Parsing user input

`parseAmount(raw: string, currency): Result<Money, ParseError>` handles, deliberately and with
tests: `"1,234.5"`, `"1234.567"` (→ `too_many_decimals`), `"₹1,234"`, `"1 234"`, `"-50"`
(→ `negative_not_allowed` in transaction contexts), `""` (→ `empty`), `"abc"` (→ `not_a_number`),
`"1e5"` (→ `not_a_number`; scientific notation is never what a person typing money means),
Devanagari digits, and full-width digits. Indian digit grouping (`12,34,567`) is accepted on input
and produced on output via `Intl` with `en-IN`.

### 1.3 Rounding policy

| Operation | Mode | Why |
|---|---|---|
| Safe daily limit | **floor** | Rounding a spending allowance *up* encourages overspending. The system's advice must never be optimistic. |
| Splits and allocations | largest remainder | Parts must sum to the whole, exactly. |
| Percentages for display | round-half-up at 1 dp | Cosmetic only; never fed back into arithmetic. |
| Projections (goal dates) | ceil days | "You'll get there in 41 days" must not be optimistic either. |
| Everything else | no rounding | `bigint` arithmetic is exact; there is nothing to round. |

---

## 2. Dates, periods, and timezones

### 2.1 `LocalDate` — a civil date with no instant

```ts
// domain/period/LocalDate.ts
type LocalDate = { readonly y: number; readonly m: number; readonly d: number };  // m is 1-12

LocalDate.fromISO('2026-09-07')
LocalDate.fromInstant(instant: Date, tz: IanaZone)   // the ONLY conversion point in the system
LocalDate.toISO(d): string                            // '2026-09-07' — what the database stores
addDays(d, n)  addMonths(d, n)  compare(a, b)  daysBetween(a, b)  isBefore  isAfter
startOfMonth(d)  endOfMonth(d)  lengthOfMonth(y, m)   // leap-year aware, no magic 28/30/31
```

`LocalDate` has no time, no offset, and no `Date` inside it. Arithmetic on it is calendar
arithmetic, so DST cannot affect it: there is no 23-hour day when there are no hours.

`LocalDate.fromInstant` is the single place a timezone is applied, implemented with
`Intl.DateTimeFormat(tz, { … }).formatToParts()` rather than string slicing. v1's bug was exactly
this conversion done wrong: `new Date().toISOString().slice(0,10)` gives the **UTC** date, so
between 00:00 and 05:30 IST every Indian user's "today" was yesterday — a wrong day for 23% of
every day, silently corrupting the streak and the "today's spend" tile.

### 2.2 `BudgetPeriod`

```ts
type BudgetPeriod = { start: LocalDate; endExclusive: LocalDate; label: string };

resolveCurrentPeriod({ today, startDay }): BudgetPeriod
resolvePeriodContaining({ date, startDay }): BudgetPeriod
nextPeriod(p, startDay)  previousPeriod(p, startDay)
daysInPeriod(p): number
daysRemaining(p, today): number     // today counts as remaining; >= 0
daysElapsed(p, today): number
```

A "month" is the user's **financial** month: `startDay` (1–28) from the profile. Someone paid on
the 25th gets a period of 25 Aug → 24 Sep, which is what their money actually does. Calendar months
are the special case `startDay = 1`, not the model.

`startDay` is capped at 28 so every month contains the day. The alternative — clamping day 31 to
"last day of month" — creates periods of unequal, surprising length and an off-by-one at every
February. Capping is the boring choice and it is documented in the onboarding UI.

### 2.3 Date edge cases — the test table

Every row is an executed test in `domain/period/__tests__`.

| Case | Expected behaviour |
|---|---|
| IST user, 00:30 local on 8 Sep (= 19:00 UTC 7 Sep) | `today = 2026-09-08`. The v1 regression test. |
| IST user, 23:59 local on 30 Sep | Still period September; the October period begins at 00:00 local on 1 Oct. |
| `America/Los_Angeles`, spring-forward day (23 h) | `daysBetween` = 1. Calendar arithmetic, not `(t2−t1)/86400000`. |
| `America/Los_Angeles`, fall-back day (25 h) | `daysBetween` = 1. |
| `Pacific/Chatham` (UTC+12:45) | Fractional offsets handled — `formatToParts`, never `getTimezoneOffset()`. |
| Leap day, 29 Feb 2028 | `lengthOfMonth(2028, 2) = 29`; a period 1–29 Feb has 29 days, not 28 or 30. |
| Non-leap February | 28 days. |
| Period with `startDay = 28`, February | 28 Feb → 27 Mar. Valid every year including leap years. |
| 31-day vs 30-day month | Daily limit differs between March and April for the same budget. **This is correct**, and it is the concrete reason `/30` is wrong. |
| `daysRemaining` on the final day | 1, never 0 — dividing by zero days is undefined; the last day's allowance is everything left. |
| `today` before the period starts | `daysRemaining` = full period length; spent = 0. |
| `today` after the period ends | `{ status: 'period_ended' }`; the UI shows a summary, not a limit. |
| Timezone changed in settings mid-period | Period boundaries recompute from the new zone. Already-stored `occurred_on` values are **not** rewritten — the user's memory of "I spent that on the 7th" is authoritative. Documented in the UI. |
| Device clock wrong / in the past | `daily_check_in` clamps: a `p_today` before `last_check_in_on` is rejected server-side; a `p_today` far ahead of the server date is rejected. |
| Transaction dated in the future, inside the period | Counted as spent. It is money the user has committed. |
| Transaction dated beyond the period | Excluded from this period; appears in the period that contains it. |

---

## 3. `calculateSafeDailyLimit` — the signature calculation

### 3.1 Contract

```ts
export interface SafeDailyLimitInput {
  period: BudgetPeriod;
  today: LocalDate;
  plan: {
    expectedIncome:  Money;   // budget_periods.expected_income_minor  (the plan)
    plannedFixed:    Money;   // rent, EMIs, subscriptions
    plannedSavings:  Money;   // pay-yourself-first
    rolloverIn:      Money;   // carried surplus (+) or deficit (−) from the previous period
    overallLimit?:   Money;   // optional explicit cap on total variable spend
  };
  actuals: {
    incomeReceived:      Money;  // sum of income transactions in the period
    fixedPaid:           Money;  // spend in categories with treatment = 'fixed'
    variableSpent:       Money;  // spend in categories with treatment = 'variable'
    refundsAgainstVariable: Money;
  };
  upcomingPlanned: Money;        // known future expenses inside the period. 0 at MVP.
  policy?: { incomeBasis?: 'planned' | 'actual' | 'greater' };  // default 'greater' — ADR-0021
}

export type SafeDailyLimitResult =
  | { status: 'ok' | 'tight' | 'comfortable';
      limit: Money; daysRemaining: number; remaining: Money; buffer: Money;
      breakdown: BreakdownLine[]; explanation: string }
  | { status: 'overspent';
      limit: Money /* zero */; overspentBy: Money; daysRemaining: number;
      breakdown: BreakdownLine[]; explanation: string }
  | { status: 'insufficient_data'; missing: Array<'expected_income' | 'budget_period'> }
  | { status: 'period_ended'; period: BudgetPeriod };

type BreakdownLine = { key: string; label: string; amount: Money; sign: '+' | '−' | '=' };
```

The result carries its own `breakdown`, so the UI can show *why* the number is what it is without
knowing how it was derived. That is what lets a smarter strategy ship later without touching a
component.

### 3.2 Algorithm

```
 1. if today >= period.endExclusive        → { status: 'period_ended' }
 2. if expectedIncome == 0 and incomeReceived == 0 and rolloverIn == 0
                                           → { status: 'insufficient_data',
                                               missing: ['expected_income'] }
 3. daysRemaining = max(1, daysBetween(today, period.endExclusive))
    (if today < period.start, daysRemaining = daysInPeriod(period))
 4. income        = incomeBasis == 'planned' ? expectedIncome
                  : incomeBasis == 'actual'  ? incomeReceived
                  :                            max(expectedIncome, incomeReceived)
 5. fixedAllowance = max(plannedFixed, fixedPaid)
 6. available      = income + rolloverIn − fixedAllowance − plannedSavings − upcomingPlanned
 7. if overallLimit is set: available = min(available, overallLimit)
 8. netVariable    = max(0, variableSpent − refundsAgainstVariable)
 9. remaining      = available − netVariable
10. if remaining <= 0 → { status: 'overspent', limit: 0, overspentBy: −remaining }
11. { quotient, remainder } = divideFloor(remaining, daysRemaining)
12. limit = quotient;  buffer = remainder
13. status = classify(limit, remaining, daysRemaining)
```

### 3.3 Assumptions, stated so they can be argued with

| # | Assumption | If we are wrong |
|---|---|---|
| S1 | **`incomeBasis: 'greater'`.** Budget against the plan, but if actual receipts already exceed it, the extra is spendable. **Decided and recorded in [ADR-0021](./adr/0021-safe-daily-limit-income-basis.md)**, which supersedes assumption A9 in [ARCHITECTURE.md §0](./ARCHITECTURE.md) — that assumption said `planned` and was never struck through, so both readings were live for three drafts. | `'planned'` is more conservative (ignores a bonus until next period); `'actual'` breaks the first half of the month, when salary has not landed and the limit would read ₹0. Configurable, defaulted, tested in all three modes. |
| S2 | **`fixedAllowance = max(plan, actual)`.** If real fixed spend already exceeded the plan, the excess is genuinely gone. | Using the plan alone lets an overspent rent silently inflate the discretionary allowance. |
| S3 | **Refunds net against variable spend**, floored at zero. | This *contradicts* an earlier draft assumption (A8) that refunds are income. Netting is more truthful: a returned ₹2,000 shirt did not make you ₹2,000 richer, it un-spent ₹2,000. `kind='refund'` exists precisely so the two are distinguishable. |
| S4 | **`daysRemaining` includes today.** | Excluding it means the last day of the period has a limit of ₹0 while money remains. |
| S5 | **Floor, not round.** | Rounding up hands out money that is not there, `daysRemaining` times over. |
| S6 | **Future-dated transactions inside the period count as spent.** | They are committed money. Excluding them shows an allowance that a known future debit will consume. |
| S7 | **`upcomingPlanned = 0` at MVP.** | The field exists in the contract from day one, so recurring transactions (Milestone 12) fill it in without a signature change. |
| S8 | **The limit is advice, not a control.** Nothing blocks a transaction that exceeds it. | A finance app that refuses to record reality stops being a record of reality. |

### 3.4 Worked example

```
Period 1–30 Sep, today = 11 Sep, startDay = 1
expectedIncome  ₹60,000    incomeReceived  ₹60,000
plannedFixed    ₹25,000    fixedPaid       ₹25,000
plannedSavings  ₹10,000    rolloverIn      ₹0
variableSpent   ₹ 8,000    refunds         ₹  500

income        = max(60000, 60000)               = ₹60,000
fixedAllowance= max(25000, 25000)               = ₹25,000
available     = 60000 + 0 − 25000 − 10000 − 0   = ₹25,000
netVariable   = 8000 − 500                      = ₹ 7,500
remaining     = 25000 − 7500                    = ₹17,500
daysRemaining = 30 − 11 + 1                     = 20
limit         = floor(1750000 / 20)             = ₹875.00,  buffer ₹0.00
```

The naive v1 formula on the same data gives `floor((60000 − 25000 − 10000)/30) = ₹833/day`, a number
that never changes all month, ignores the ₹7,500 already spent, and is still ₹833 on the 30th.

### 3.5 Edge-case matrix (each a test)

| Input | Result |
|---|---|
| Zero income, zero rollover | `insufficient_data` — **not** ₹0. Showing ₹0/day to a user who has not set a budget is a lie the UI must not tell. |
| Income entirely consumed by fixed + savings | `available = 0` → `overspent` with `overspentBy = netVariable`, `limit = 0` |
| Negative available (fixed + savings > income) | `overspent`, `limit = 0`, breakdown shows the negative available line so the cause is visible |
| Already over budget | `overspent` with the exact amount, plus "₹X over with Y days to go" |
| Last day of the period | `daysRemaining = 1`, `limit = remaining` |
| First day, nothing spent | `limit = floor(available / daysInPeriod)` |
| Period not started (viewing next month) | `daysRemaining = daysInPeriod`, `spent = 0` |
| Period ended (viewing history) | `period_ended` → the UI shows the outcome summary instead |
| `remaining` not divisible by `daysRemaining` | `buffer` carries the leftover paise; `limit × daysRemaining + buffer = remaining` exactly (a property test) |
| 28-, 29-, 30-, 31-day periods | Different limits for the same plan. Correct, and asserted. |
| `overallLimit` below computed available | `available` clamped to the limit |
| Mixed currencies in inputs | Throws — a programmer error, caught in tests |
| Very large values (₹9 × 10^11) | Exact; no precision loss (property test against `bigint`) |

### 3.6 The strategy extension point

```ts
export interface SafeDailyLimitStrategy {
  readonly id: string;
  calculate(input: SafeDailyLimitInput): SafeDailyLimitResult;
}
```

MVP ships `EvenSpreadStrategy` (§3.2). Later candidates — `WeekendWeightedStrategy` (people spend
more on Saturdays), `ForecastAwareStrategy` (reserve for the historical tail of the month),
`GoalAwareStrategy` (protect this month's goal contributions) — implement the same interface and
return the same result shape. The widget consumes `SafeDailyLimitResult` and never learns which
strategy produced it. Strategy selection is a profile preference, so an A/B test is a config change.

---

## 4. Budget engine

```ts
calculateBudgetUsage({ limit, spent, refunded, today, period }): {
  spentNet: Money; remaining: Money; usageRatio: number;   // 0..n, may exceed 1
  status: 'no_limit' | 'ok' | 'approaching' | 'at_limit' | 'exceeded';
  pace: 'ahead' | 'on_track' | 'behind';    // usageRatio vs elapsedRatio
  projectedEndOfPeriod: Money;              // linear projection at the current rate
}
```

Thresholds — one place, one config object, product-owned: `approaching ≥ 0.75`, `at_limit ≥ 1.0`,
`exceeded > 1.0`. `pace` compares `usageRatio` against `daysElapsed / daysInPeriod`, which is what
turns "you have spent 60% of your food budget" into the actionable "…and you are only 40% through
the month".

`calculateOverallBudgetUsage` aggregates the same shape across categories, using
`overallLimit ?? (expectedIncome + rolloverIn − plannedFixed − plannedSavings)` as the denominator
when no explicit cap is set.

### 4.1 Rollover

At period close, `ensure_budget_period` computes for the new period:

```
rolloverIn(N) = rollover_enabled(N−1) ? (available(N−1) − netVariableSpent(N−1)) : 0
```

Both signs carry: a surplus increases next month's allowance, a deficit reduces it. Carrying only
surpluses would make the number a reward rather than a fact. Per-category rollover uses the same
formula against the category limit, and is opt-in per category.

### 4.2 Editing a budget after transactions exist

The question the brief asks, answered explicitly:

- **A budget is a plan. Transactions are facts.** Editing the plan changes every derived number for
  that period immediately — usage, remaining, safe daily limit. It never modifies a transaction.
- **Nothing is retroactively "un-spent".** If you raise September's food limit from ₹5,000 to
  ₹7,000 after spending ₹6,000, the status flips from `exceeded` to `approaching`. That is the
  honest result of changing your own plan.
- **Every edit is audited.** `audit_log` records the old and new values with a timestamp, so
  "why does September look fine now?" has an answer.
- **Closed periods are immutable.** Once `closed_at` is set, the RLS `UPDATE` policy refuses
  changes. Editing history would make budget history worthless. Reopening is a deliberate,
  audited action, not a side effect of navigating to an old month.
- **Deleting a category limit** deletes the limit, not the spending. Transactions keep their
  category; the category simply stops being budgeted.

---

## 5. Goals

```ts
calculateGoalProgress({ target, saved }): {
  progressRatio: number;        // raw, may exceed 1
  displayRatio: number;         // clamped 0..1 for the progress bar
  remaining: Money;             // max(0, target − saved)
  isAchieved: boolean;
}

calculateGoalPlan({ target, saved, targetDate, today }): {
  daysRemaining: number;
  requiredPerDay: Money; requiredPerWeek: Money; requiredPerMonth: Money;
  status: 'on_track' | 'behind' | 'achieved' | 'overdue' | 'no_target_date';
}

projectGoalCompletion({ target, saved, contributions, today, windowDays = 90 }):
  | { status: 'projected'; date: LocalDate; ratePerDay: Money; confidence: 'low' | 'medium' | 'high' }
  | { status: 'achieved' }
  | { status: 'no_projection'; reason: 'no_contributions' | 'net_negative_rate' | 'too_few_points' }
```

Edge cases, each tested: target already met (`achieved`, no projection); `targetDate` in the past
and unmet (`overdue`); a single contribution (`too_few_points` — one point is not a rate, and
inventing a projection from it is the kind of confident nonsense that destroys trust); withdrawals
exceeding deposits in the window (`net_negative_rate`); `saved > target` (progress capped for
display, real value reported); zero-length contribution history; a `target_date` today.

**Progress is derived, cached, and recoverable.** `goals.saved_minor` is a trigger-maintained
recompute of `sum(goal_contributions.amount_minor)`; the ledger is the source of truth; the client
cannot write either — not on `UPDATE` and not at row creation
([ADR-0019](./adr/0019-insert-column-grants.md)). Full four-part consistency treatment in
[DATABASE.md §6.8](./DATABASE.md).

---

## 6. Gamification rules

All pure functions over explicit inputs; **all XP is awarded server-side**, and these functions only
*predict* what the server will do so the UI can respond instantly.

```ts
levelForXp(xp: number): number                 // floor(xp / 100) + 1
xpForLevel(level: number): number              // (level − 1) * 100
progressToNextLevel(xp): { current, needed, ratio }

nextStreak({ lastCheckInOn: LocalDate | null, today: LocalDate, current: number }):
  { streak: number; changed: boolean; reason: 'first' | 'same_day' | 'continued' | 'reset' | 'invalid' }
```

Streak transition table (the v1 bug lived here — it compared a UTC date string to a `timestamptz`):

| `lastCheckInOn` | Result |
|---|---|
| `null` | `streak = 1`, `first` |
| `= today` | unchanged, `same_day` — idempotent, so ten check-ins in a day are one |
| `= today − 1` | `streak + 1`, `continued` |
| `< today − 1` | `streak = 1`, `reset` |
| `> today` (clock skew or a manipulated client) | unchanged, `invalid` — the server rejects it too |

**XP catalog** (config, product-owned, one module, mirrored by the `award_xp` calls in SQL):

| Event | XP | Dedupe key | Cap |
|---|---|---|---|
| `transaction_logged` | 5 | `tx:<uuid>` | 5 awards per civil day |
| `daily_check_in` | 10 | `check_in:<date>` | once per day |
| `goal_contribution` | 15 | `contrib:<uuid>` | 10 per day |
| `budget_reviewed` | 5 | `review:<period>` | once per period |
| `period_under_budget` | 50 | `under:<period>` | once per period, at close |
| `goal_achieved` | 100 | `goal:<uuid>` | once ever |
| `achievement_unlocked` | catalog value | `ach:<code>` | once ever |

The daily caps exist because XP must reward *habits*, not *keystrokes*. Without them, "log 200
one-rupee expenses" is the optimal strategy — which is both farmable and actively bad financial
behaviour to encourage.

**Achievements** are predicates over a snapshot, evaluated server-side after the events that could
satisfy them:

```ts
interface Achievement {
  code: string; name: string; description: string; xpReward: number;
  isUnlocked(snapshot: AchievementSnapshot): boolean;
}
```

MVP catalog: `first_transaction`, `first_goal`, `first_contribution`, `streak_7`, `streak_30`,
`under_budget_month`, `saved_10k`, `all_categories_used`, `budget_set`, `goal_achieved`.
Adding one is a catalog row plus a predicate — never a schema change.

---

## 7. Analytics

The layering the brief asks for, made explicit:

```
Raw ledger            transactions, goal_contributions, gamification_events
   │                  (append-only facts; never mutated by analytics)
   ▼
Aggregations          SQL. get_period_summary, sums by category / month / account.
   │                  Deterministic, cacheable, no interpretation.
   ▼
Analytics             domain/analytics. Ratios, trends, comparisons, projections.
   │                  Pure functions over aggregates. No opinions, just derived numbers.
   ▼
Insights              domain/insights. Interpretation: "you spent 24% more on food".
                      Behind the InsightProvider port — rules now, ML/AI later,
                      same interface, no change above this line.
```

| Function | Notes |
|---|---|
| `aggregateByCategory({ totals, categories })` | Sorted, with share-of-total; refunds netted per category |
| `spendingOverTime({ dailyTotals, period, granularity })` | Fills gaps with zero — a missing day must render as ₹0, not as a break in the line |
| `incomeVsExpenses({ periods })` | Per period, with net |
| `calculateSavingsRate({ income, expenses })` | `(income − expenses) / income`; `income = 0` → `{ status: 'undefined' }`, never `NaN` or `Infinity` reaching a component |
| `compareToPreviousPeriod({ current, previous })` | Absolute and percentage delta; `previous = 0` → "new", not "+∞%" |
| `budgetUtilisation({ limits, spends })` | Per category and overall |
| `spendingTrend({ series, window })` | Simple moving average; explicitly labelled a trend, not a prediction |

**Future-proofing without building it:** anomaly detection consumes the same aggregates and emits
`Insight[]`; forecasting consumes the same series and emits `Insight[]`. Both are additional
`InsightProvider` implementations. The dashboard widget renders `Insight[]` and is written once.
That is the whole of the AI extension point — one interface, no premature machinery.

---

## 8. Financial health score *(Milestone 8, contract fixed now)*

```ts
calculateFinancialHealthScore({ savingsRate, budgetAdherence, trackingConsistency,
                                goalProgress, spendingVolatility }):
  { score: number /* 0-100 */; band: 'needs_attention' | 'fair' | 'good' | 'strong';
    components: Array<{ key; score; weight; explanation }> }
```

Weights (product-owned config, not code): savings rate 30, budget adherence 25, tracking
consistency 20, goal progress 15, spending volatility 10. The result returns its components so the
UI shows *what to improve*, not just a number — a score without a next action is decoration.

Each component is independently pure and independently tested. A component returning
`insufficient_data` is excluded and the remaining weights are renormalised, so a user with no goals
does not score 0 on a dimension that does not apply to them.

---

## 9. Testing the engine

Every function in `src/domain/**` carries a co-located `*.test.ts`. Coverage gate: **100% branches**
on `domain/money`, `domain/period`, `domain/budget`, `domain/goals`, `domain/gamification`.

- **Table-driven tests** for every edge case listed in this document.
- **Property tests** (fast-check) for the invariants:
  `allocate` sums to the input; `limit × daysRemaining + buffer = remaining`; `add`/`subtract` are
  inverse; `parseAmount(format(m)) === m`; `daysBetween(a, addDays(a, n)) === n` across DST
  boundaries and leap years.
- **Fixed clocks.** `vi.setSystemTime` plus an injected `Clock`; the same suite runs under
  `TZ=Asia/Kolkata`, `TZ=UTC`, and `TZ=America/Los_Angeles` in CI, because a test that passes only
  in the developer's timezone tests nothing.
- **Regression tests named after v1's bugs**, so they can never come back:
  `safe-daily-limit does not divide by 30`, `today is user-local not UTC`,
  `streak survives a UTC/IST boundary`, `transfer does not count as expense`,
  `goal total ignores a client-supplied saved amount`.
