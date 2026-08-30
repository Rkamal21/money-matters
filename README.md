# 💰 Money Matters

**Track smart. Save smarter.** A personal finance tracker for expenses, savings
goals, spending habits and a simple monthly budget — with light gamification
(XP, levels, streaks). Amounts are in ₹ (INR).

Runs as a mobile-first web app and ships to Android via Capacitor.

## Features

- **Home** – Quick-add an expense (amount, description, category), with the
  category auto-inferred from the description for a few known merchants
  (Swiggy → Food, Amazon → Shopping, Uber → Travel). Shows today's spend, this
  month's total, your daily budget if set, and the 15 most recent expenses with
  delete.
- **Goals** – Create savings goals with a target, track progress on a bar, add
  a custom deposit or use the quick buttons (+₹100 / ₹500 / ₹1000), and delete.
- **Habits** – Spending broken down by category for the current month, with
  proportional bars and a month total.
- **Budget** – Enter monthly income, fixed expenses and a savings target; the app
  shows a **safe daily limit** of `max(0, floor((income − fixed − savings) / 30))`.
- **Gamification** – +10 XP per expense logged, one level per 100 XP, and a day
  streak that increments when you log on consecutive days.
- **Accounts** – Email + password sign-up and sign-in via Supabase Auth.
- **Theme** – Dark (default) and light, remembered across sessions.

## Tech

- **React 19** + **Vite 7** — single-page app, no router (tab state in `App.jsx`)
- **Supabase** — Postgres + Auth; the browser talks to it directly through
  `@supabase/supabase-js`, with Row-Level Security scoping every row to the
  signed-in user
- **Capacitor 6** — Android packaging (`appId: com.moneymatters.app`)
- Plain CSS with custom properties; no UI framework

State lives in `src/hooks/` — one hook per table (`useAuth`, `useExpenses`,
`useGoals`, `useBudget`, `useProfile`), each talking to Supabase directly.

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the database

In your Supabase project, open the SQL editor and run
[`supabase_schema.sql`](./supabase_schema.sql). It creates four tables —
`profiles`, `expenses`, `goals`, `budgets` — enables Row-Level Security on each,
and adds a trigger that creates a profile row on sign-up.

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in both values from **Project Settings → API** in the Supabase dashboard:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Both are required — the app throws at startup if either is missing.

### 4. Run

```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run cap:sync` | Build, then copy the web bundle into `android/` |
| `npm run cap:android` | Open the project in Android Studio |
| `npm run build:apk` | Sync, then assemble a debug APK (Windows) |

## Android

The web build is wrapped with Capacitor. After changing web code, run
`npm run cap:sync` before building the APK — otherwise the APK keeps serving the
previously synced bundle.

### Known gap

The Android project contains an unfinished native feature: a broadcast receiver
(`android/app/src/main/kotlin/com/moneymatters/app/sms/`) that parses bank
transaction SMS into a local Room database. It is **not wired into the app** —
there is no Capacitor bridge to the web layer and the Room DAO exposes no read
method, so nothing surfaces those rows. The `RECEIVE_SMS` permission in the
manifest exists only for this incomplete feature.

---

*Money Matters* – one place to track spending, hit goals, and see where your
money goes.
