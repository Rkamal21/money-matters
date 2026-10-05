import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { today as todayIn } from '@/domain/period/Clock'
import { fromISO, toISO, type LocalDate } from '@/domain/period/LocalDate'
import type { Profile } from '@/domain/profile/Profile'
import { systemClock } from '@/lib/clock'
import { AppErrorException, unexpectedError } from '@/lib/errors'
import { LEDGER_KEYS, queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

import { repositories } from '../repositories'

/**
 * Server state that more than one feature reads. A feature may not import
 * another feature (eslint boundaries), so what they share lives one layer
 * down, here, next to the repositories it wraps.
 *
 * Every hook is TanStack Query: caching, dedupe, retry and invalidation once,
 * instead of v1's five hand-rolled versions (ADR-0012).
 */

export function useProfile() {
  const userId = useUserId()
  return useQuery({
    queryKey: queryKeys.profile(),
    queryFn: () => repositories.profiles.get(userId),
    staleTime: 5 * 60_000,
  })
}

/** Currency, locale and zone, with safe defaults while the profile loads. */
export function usePreferences(): Pick<
  Profile,
  'currency' | 'locale' | 'timezone' | 'budgetPeriodStartDay'
> {
  const profile = useProfile().data
  return {
    currency: profile?.currency ?? 'INR',
    locale: profile?.locale ?? 'en-IN',
    timezone: profile?.timezone ?? 'Asia/Kolkata',
    budgetPeriodStartDay: profile?.budgetPeriodStartDay ?? 1,
  }
}

// A one-minute heartbeat, so "today" rolls over at the user's midnight while
// the app is open, without every component running its own timer.
const minuteListeners = new Set<() => void>()
let minuteTick = 0
let minuteTimer: number | undefined

function subscribeToMinutes(listener: () => void): () => void {
  minuteListeners.add(listener)
  if (minuteListeners.size === 1) {
    minuteTimer = window.setInterval(() => {
      minuteTick += 1
      minuteListeners.forEach((notify) => notify())
    }, 60_000)
  }
  return () => {
    minuteListeners.delete(listener)
    if (minuteListeners.size === 0) window.clearInterval(minuteTimer)
  }
}

/**
 * The user's civil date, in their own timezone — never the UTC date
 * (FINANCIAL-ENGINE.md §2.1, the v1 regression). `null` until the profile has
 * loaded, because without the zone there is no honest answer.
 */
export function useToday(): LocalDate | null {
  const timezone = useProfile().data?.timezone
  useSyncExternalStore(
    subscribeToMinutes,
    () => minuteTick,
    () => minuteTick,
  )
  const iso = timezone === undefined ? null : toISO(todayIn(systemClock, timezone))
  return useMemo(() => (iso === null ? null : fromISO(iso)), [iso])
}

export function useAccounts() {
  const userId = useUserId()
  return useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => repositories.accounts.list(userId),
  })
}

export function useCategories() {
  const userId = useUserId()
  return useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => repositories.categories.list(userId),
    staleTime: 5 * 60_000,
  })
}

export function useMerchantRules() {
  return useQuery({
    queryKey: queryKeys.merchantRules(),
    queryFn: () => repositories.merchantRules.list(),
    staleTime: 10 * 60_000,
  })
}

export function useGoals() {
  const userId = useUserId()
  return useQuery({
    queryKey: queryKeys.goals(),
    queryFn: () => repositories.goals.list(userId),
  })
}

export function useGamificationProfile() {
  const userId = useUserId()
  return useQuery({
    queryKey: queryKeys.gamification(),
    queryFn: () => repositories.gamification.getProfile(userId),
  })
}

/**
 * The budget period containing today, created on first sight of a new month
 * (`ensure_budget_period` is idempotent and race-safe, DATABASE.md §12).
 */
export function useCurrentPlan() {
  const today = useToday()
  const { currency } = usePreferences()
  const key = today === null ? 'pending' : toISO(today)
  return useQuery({
    queryKey: queryKeys.budget(`current:${key}`),
    enabled: today !== null,
    queryFn: () => {
      if (today === null) throw new AppErrorException(unexpectedError('today unknown'))
      return repositories.budgets.ensurePeriod(today, currency)
    },
  })
}

/** Everything a ledger write can move, invalidated at once (lib/queryKeys.ts). */
export function useInvalidateLedger(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await Promise.all(LEDGER_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  }, [queryClient])
}
