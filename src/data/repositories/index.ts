import { supabase } from '../supabase/client'

import { SupabaseAccountRepository } from './AccountRepository'
import { SupabaseAnalyticsRepository } from './AnalyticsRepository'
import { SupabaseAuthRepository } from './AuthRepository'
import { SupabaseBudgetRepository } from './BudgetRepository'
import { SupabaseCategoryRepository } from './CategoryRepository'
import { SupabaseGamificationRepository } from './GamificationRepository'
import { SupabaseGoalRepository } from './GoalRepository'
import { SupabaseMerchantRuleRepository } from './MerchantRuleRepository'
import { SupabaseProfileRepository } from './ProfileRepository'
import { SupabaseTransactionRepository } from './TransactionRepository'

/**
 * The wired repositories. Features import these; they never see the client
 * behind them. Swapping Supabase for an HTTP tier is a change to this file and
 * the implementations, and to no feature (ARCHITECTURE.md §A.3).
 */
export const repositories = {
  auth: new SupabaseAuthRepository(supabase),
  profiles: new SupabaseProfileRepository(supabase),
  accounts: new SupabaseAccountRepository(supabase),
  categories: new SupabaseCategoryRepository(supabase),
  transactions: new SupabaseTransactionRepository(supabase),
  budgets: new SupabaseBudgetRepository(supabase),
  goals: new SupabaseGoalRepository(supabase),
  gamification: new SupabaseGamificationRepository(supabase),
  merchantRules: new SupabaseMerchantRuleRepository(supabase),
  analytics: new SupabaseAnalyticsRepository(supabase),
} as const

export type Repositories = typeof repositories

export type { AccountPatch, NewAccount } from './AccountRepository'
export type {
  AnalyticsRepository,
  DashboardSnapshot,
  Granularity,
  MonthComparison,
  RecentTransaction,
  SnapshotAccount,
  SpendingPoint,
} from './AnalyticsRepository'
export type { AuthEvent, AuthSession } from './AuthRepository'
export type { PlanPatch } from './BudgetRepository'
export type { CategoryPatch, NewCategory } from './CategoryRepository'
export type { GoalPatch, NewGoal } from './GoalRepository'
export type { LearnedRule } from './MerchantRuleRepository'
export type { ProfilePatch } from './ProfileRepository'
export type {
  NewTransaction,
  SplitPart,
  TransactionFilter,
  TransactionPatch,
} from './TransactionRepository'
export type { Page } from './types'
