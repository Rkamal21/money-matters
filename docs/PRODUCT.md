# Money Matters 2.0 — Product Architecture

Status: **Proposed** · Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) · Date: 2026-09-07

---

## 1. What this product is

Money Matters helps a person make better financial decisions. It is not an expense tracker with
extra screens — tracking is the *input*, not the product. The product is the answer that comes back.

**The one-sentence test:** if a user opens the app and learns nothing they did not already know,
we have built a database with a form on it.

---

## 2. The core loop

```
        EARN ──────► PLAN ──────► SPEND
          ▲                          │
          │                          ▼
      IMPROVE                      TRACK
          ▲                          │
          │                          ▼
        SAVE  ◄───── ADJUST ◄──── UNDERSTAND
```

Each stage maps to a concrete part of the system, and each has a question it must answer:

| Stage | User question | Feature | Domain module |
|---|---|---|---|
| **Earn** | What is coming in? | Income transactions, expected income in the budget plan | `transactions` |
| **Plan** | What am I allowed to spend? | Budget periods, category limits, savings target | `budget` |
| **Spend** | *(happens outside the app)* | — | — |
| **Track** | What did I actually spend? | Fast transaction entry, categorisation, later SMS ingest | `transactions`, `categorize` |
| **Understand** | Where is it going? Am I on track? | Dashboard, analytics, spending breakdown | `analytics` |
| **Adjust** | How much can I safely spend today? | **Safe daily limit**, budget status | `budget` |
| **Save** | Am I getting anywhere? | Goals — each the purpose of a wallet | `goals` |
| **Improve** | What should I change next? | Insights, streaks, financial health score | `insights`, `health` |

**The loop closes at Adjust → Save.** Most trackers stop at Understand and leave the user with a
pie chart. The safe daily limit is the product's spine because it is the only number that converts
understanding into a decision a person can act on before lunch.

---

## 3. The questions the app must answer

Directly from the brief. Each is a UI surface with an owner, so none of them quietly goes missing:

| Question | Where it is answered | Depends on |
|---|---|---|
| Where is my money going? | Spending Breakdown widget; Analytics → by category | categorisation quality |
| How much can I safely spend? | Safe Daily Limit widget (the hero number) | budget plan + `treatment` classification |
| Am I staying within my budget? | Budget Status widget; Budget screen | category limits |
| Am I saving enough? | Savings rate in Analytics; Goals widget | income + expense completeness |
| How close am I to my goals? | Goals widget; goal detail with projection | the goal wallet's balance |
| Which habits are improving? | Analytics → month comparison; streaks; health score | ≥ 2 periods of history |
| What should I change next? | Insights widget | rules engine (M8), AI later (M13) |

The last two require history the app does not have on day one. That is designed for rather than
faked: an insight with no data says "keep tracking — this unlocks after your first full month",
not a made-up number. Fabricating an insight to fill a card is the fastest way to lose a
finance user's trust, and it is not permitted.

---

## 4. Product principles

1. **Trustworthy over clever.** Every number is explainable. The safe daily limit ships with its
   own breakdown because "₹875" without "here's why" is a number people stop believing.
2. **Never lie by omission.** No income set means "set up your budget", not "₹0/day". An unknown is
   shown as unknown. See `insufficient_data` in [FINANCIAL-ENGINE.md](./FINANCIAL-ENGINE.md).
3. **Fast entry or no data.** Logging an expense must take under 10 seconds on a phone with one
   hand. Everything else in the product is downstream of that; if entry is slow, the ledger is
   empty and every other feature is decoration.
4. **The app never blocks reality.** It advises; it does not refuse to record an overspend. A ledger
   that argues with the user stops being a ledger.
5. **Mobile-first, one-handed.** Base layout is 360 px. Primary actions sit in thumb reach.
6. **Privacy is a feature.** No third-party analytics carrying financial values. Bank SMS parsed on
   device, never stored, never transmitted.
7. **Playful in tone, serious in substance.** Copy can have warmth; numbers cannot. No confetti over
   a balance, no mascot, no shame-based nudges.
8. **Gamification is opt-in and secondary.** It reinforces the habit; it never becomes the point.

---

## 5. MVP scope

**In** (Milestones 1–7 — the first release):

- Email/password auth with confirmation and reset
- Onboarding: income, period start day, savings target, first account
- Multiple accounts: cash, bank, savings, credit card, and **wallets** — containers for money with a
  purpose (an e-wallet balance, or a pot that backs a goal)
- Transactions: income, expense, **transfer**, refund; manual entry, splits, edit, soft delete
- Categories: 12 seeded, fully editable, user-created, archivable, `fixed`/`variable`/`excluded`
- Merchant-rule categorisation with user overrides that teach the system
- Budget: per-period plan, category limits, rollover, full history
- **Safe daily limit** with a visible breakdown
- Savings goals: each backed by one wallet, funded by transfers, with progress projection. A goal
  is the *purpose* of money, never a second balance
  ([ADR-0026](./adr/0026-goals-are-the-purpose-of-a-wallet.md))
- Modular dashboard: balance, safe daily limit, budget status, recent transactions, breakdown,
  goals, month summary
- Dark/light theme; full keyboard and screen-reader support

**Out of the first release, designed for:**

| Deferred | Milestone | Why deferred |
|---|---|---|
| Analytics screen: by category, over time, income vs expenses, savings rate, month comparison | 8 | Needs at least two periods of data before any of it says something true |
| Gamification: XP, levels, streaks, ten achievements | 9 | The **schema** and `award_xp` land in M1 so the signup trigger is stable; the award triggers and the surfaces land together in M9. They are an amplifier, not the product |
| Android app | 11 | The web app must be right first; Capacitor wraps the same bundle |
| Bank SMS automation | 12 | Google Play policy risk is unresolved (R5); a hard dependency here would be a product bet on someone else's approval |
| AI insights | 13 | A rules engine covers the top 10 insights; AI without a data corpus is a demo |
| Recurring transactions | post-MVP | Feeds `upcomingPlanned`, which already exists in the calculation contract |
| Multi-currency | post-MVP | Every money row already carries a currency code |
| Households / shared budgets | not planned | Would change every RLS policy; a deliberate scope wall |
| CSV/statement import | 12 (with SMS) | Same ingestion pipeline, different source adapter |

**Never:** ads, selling or sharing user financial data, dark patterns around subscriptions,
credit-score-style scoring sold to third parties.

---

## 6. Users

Not a persona exercise; these are the three shapes that change design decisions.

| | **Priya, 26 — salaried, urban India** | **Arjun, 21 — student, irregular income** | **Ravi, 34 — freelancer** |
|---|---|---|---|
| Income | ₹60k/month on the 1st | ₹8–15k, unpredictable | Lumpy, ₹0–200k per month |
| Pain | Money "disappears" by the 20th | Runs out before the month does | Cannot tell a good month from a bad one |
| Needs | Safe daily limit, category budgets | Very fast entry, small numbers, forgiving | Period comparison, income smoothing, savings rate |
| Design impact | The default experience | UI must never shame a ₹40 entry; empty states must be encouraging | `incomeBasis` policy must handle actual ≫ planned and ≪ planned |

Priya is the primary user. Arjun's needs are why entry speed and tone are principles. Ravi's needs
are why `expectedIncome` and `incomeReceived` are separate inputs to the safe daily limit rather
than one field.

---

## 7. Dashboard composition

The dashboard is a **registry**, not a component. `DashboardGrid` renders from a config array;
adding, removing, or reordering a widget is a data change.

```ts
const DASHBOARD_WIDGETS = [
  { id: 'safe-daily-limit', span: 'full',  priority: 1 },
  { id: 'budget-status',    span: 'full',  priority: 2 },
  { id: 'balances',         span: 'half',  priority: 3 },
  { id: 'month-summary',    span: 'half',  priority: 4 },
  { id: 'spending-breakdown', span: 'full', priority: 5 },
  { id: 'goals',            span: 'full',  priority: 6 },
  { id: 'recent-transactions', span: 'full', priority: 7 },
  { id: 'insights',         span: 'full',  priority: 8, flag: 'insights' },
  { id: 'streak',           span: 'half',  priority: 9, flag: 'gamification' },
] as const;
```

Every widget owns its own query, loading skeleton, empty state, error boundary, and mobile layout.
One failing widget degrades to an inline error; the rest of the dashboard renders. That is the
direct answer to "the dashboard must handle partial data" — partial is the normal case, not an
error case.

**Priority order is the mobile order.** On a 360 px screen the user sees the safe daily limit
first, because that is the question they opened the app to answer.

---

## 8. Onboarding

Four steps, each writing to a **real** table — there is no bespoke onboarding storage to migrate
away from later:

| Step | Writes | Skippable |
|---|---|---|
| 1. Money basics — monthly income, period start day, currency | `profiles`, `budget_periods` | no |
| 2. First account — name, type, current balance | `accounts` | no |
| 3. Savings target — monthly amount, optional first goal (and its wallet) | `budget_periods`, `accounts`, `goals` | yes |
| 4. Fixed costs — mark categories as `fixed`, set a rough total | `categories`, `budget_periods` | yes |

Completion sets `profiles.onboarding_completed_at`. **Extensibility:** a fifth step is a new route
plus a bump of `onboarding_version`, which re-opens onboarding for existing users at exactly that
step. Skipped steps leave the app fully usable — the dashboard then shows honest
`insufficient_data` states with a direct link to the step that fills them, which is a better
teaching moment than a wizard nobody can escape.

---

## 9. Gamification, deliberately restrained

XP for tracking expenses, daily check-ins, goal contributions, budget reviews, and finishing a
period under budget. One level per 100 XP. Streaks for consecutive check-ins. Ten achievements.

**Shipping shape:** the tables and the award function exist from Milestone 1, because the signup
trigger writes a gamification profile. The award triggers and every surface — the XP display, the
streak, the check-in, the achievement list — land together in Milestone 9. That is deliberate: the
first release is judged on whether the safe daily limit is trusted, not on whether a streak is
showing.

Three guard rails, because gamification in a finance app fails in predictable ways:

1. **Rewards outcomes over activity where possible.** `period_under_budget` is worth 50 XP;
   logging a transaction is worth 5, capped at 5 per day. Otherwise the optimal strategy is to log
   200 one-rupee expenses, which is both farmable and bad financial behaviour to reinforce.
2. **Server-authoritative.** XP is awarded by triggers and `SECURITY DEFINER` functions, deduplicated
   by `(user_id, dedupe_key)`. v1's `xp` column was writable from the browser console.
3. **Opt-out, and visually secondary.** `profiles.gamification_enabled = false` hides every surface
   and stops the awards server-side. XP never appears above a financial number on any screen.

---

## 10. Design language

The interface should read as a serious finance product: quiet, dense where it matters, one accent
colour, generous whitespace around the numbers that matter. Full token set, component inventory,
and the six anti-drift rules are in [ARCHITECTURE.md §F.5](./ARCHITECTURE.md). The four that shape
the product most:

- **The screen has one hero number.** On the dashboard it is the safe daily limit.
- **Money is always tabular.** Columns align; digits do not jitter as values update.
- **Colour is never the only signal.** Over budget = red **and** an icon **and** words.
- **Every data surface has four states**, and empty states carry the action that fills them.

---

## 11. Success measures

Product health, not vanity. Recorded as business events carrying **no amounts**
([SECURITY.md §7](./SECURITY.md)):

| Measure | Signal | Target direction |
|---|---|---|
| Onboarding completion | the product is comprehensible | ↑ |
| Median time to log a transaction | entry speed (principle 3) | ↓, under 10 s |
| Transactions logged per active week | is the ledger real? | ↑ |
| Users with a budget set | is Plan reached? | ↑ |
| Users returning in week 2 and week 4 | is the loop closing? | ↑ |
| Transfers into goal wallets per goal per month | is Save reached? | ↑ |
| Share of periods finished under budget | **is the product working?** | ↑ |
| Category correction rate | categorisation quality | ↓ |

The last-but-one is the one that matters. Everything else can improve while the user's finances do
not, and if that happens the product has failed on its own terms.
