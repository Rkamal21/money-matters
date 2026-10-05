import type { BudgetPlan, CategoryLimit } from '@/domain/budget/BudgetPlan'
import { toWire, type Money } from '@/domain/money/Money'
import { addDays, toISO, type LocalDate } from '@/domain/period/LocalDate'

import { mapBudgetPlan, mapLimit } from '../mappers/rows'
import type { Db } from '../supabase/client'
import type { Database } from '../supabase/database.types'
import { concurrentEditError, fail } from '../supabase/mapErrors'

export interface PlanPatch {
  readonly expectedIncome?: Money
  readonly plannedFixed?: Money
  readonly plannedSavings?: Money
  readonly overallLimit?: Money | null
  readonly rolloverEnabled?: boolean
}

export interface BudgetRepository {
  /** Idempotent: finds or creates the period containing `today`, closing any that ended. */
  ensurePeriod(today: LocalDate, currency: string): Promise<BudgetPlan>
  getContaining(userId: string, date: LocalDate, currency: string): Promise<BudgetPlan | null>
  listPeriods(userId: string, currency: string, limit?: number): Promise<BudgetPlan[]>
  updatePlan(
    id: string,
    patch: PlanPatch,
    currency: string,
    expectedUpdatedAt?: string,
  ): Promise<BudgetPlan>
  listLimits(userId: string, periodId: string, currency: string): Promise<CategoryLimit[]>
  setCategoryLimit(
    userId: string,
    periodId: string,
    categoryId: string,
    limit: Money,
  ): Promise<void>
  removeCategoryLimit(periodId: string, categoryId: string): Promise<void>
}

export class SupabaseBudgetRepository implements BudgetRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async ensurePeriod(today: LocalDate, currency: string): Promise<BudgetPlan> {
    const { data, error } = await this.db.rpc('ensure_budget_period', { p_today: toISO(today) })
    if (error) fail(error, { operation: 'rpc', entity: 'budget' })
    return mapBudgetPlan(data, currency)
  }

  async getContaining(
    userId: string,
    date: LocalDate,
    currency: string,
  ): Promise<BudgetPlan | null> {
    // `period @> [date, date+1)` — a range contains the one-day range iff it contains the day.
    const { data, error } = await this.db
      .from('budget_periods')
      .select('*')
      .eq('user_id', userId)
      .filter('period', 'cs', `[${toISO(date)},${toISO(addDays(date, 1))})`)
      .maybeSingle()
    if (error) fail(error, { operation: 'read', entity: 'budget' })
    return data === null ? null : mapBudgetPlan(data, currency)
  }

  async listPeriods(userId: string, currency: string, limit = 24): Promise<BudgetPlan[]> {
    const { data, error } = await this.db
      .from('budget_periods')
      .select('*')
      .eq('user_id', userId)
      .order('period', { ascending: false })
      .limit(limit)
    if (error) fail(error, { operation: 'read', entity: 'budget' })
    return data.map((row) => mapBudgetPlan(row, currency))
  }

  async updatePlan(
    id: string,
    patch: PlanPatch,
    currency: string,
    expectedUpdatedAt?: string,
  ): Promise<BudgetPlan> {
    const row: Database['public']['Tables']['budget_periods']['Update'] = {}
    if (patch.expectedIncome !== undefined) row.expected_income_minor = toWire(patch.expectedIncome)
    if (patch.plannedFixed !== undefined) row.planned_fixed_minor = toWire(patch.plannedFixed)
    if (patch.plannedSavings !== undefined) row.planned_savings_minor = toWire(patch.plannedSavings)
    if (patch.overallLimit !== undefined) {
      row.overall_limit_minor = patch.overallLimit === null ? null : toWire(patch.overallLimit)
    }
    if (patch.rolloverEnabled !== undefined) row.rollover_enabled = patch.rolloverEnabled

    let query = this.db.from('budget_periods').update(row).eq('id', id)
    if (expectedUpdatedAt !== undefined) query = query.eq('updated_at', expectedUpdatedAt)
    const { data, error } = await query.select('*').maybeSingle()
    if (error) fail(error, { operation: 'update', entity: 'budget' })
    // Zero rows: edited elsewhere, or the period closed (its policy refuses writes).
    if (data === null) throw concurrentEditError('budget')
    return mapBudgetPlan(data, currency)
  }

  async listLimits(userId: string, periodId: string, currency: string): Promise<CategoryLimit[]> {
    const { data, error } = await this.db
      .from('budget_category_limits')
      .select('*')
      .eq('user_id', userId)
      .eq('budget_period_id', periodId)
    if (error) fail(error, { operation: 'read', entity: 'budget' })
    return data.map((row) => mapLimit(row, currency))
  }

  async setCategoryLimit(
    userId: string,
    periodId: string,
    categoryId: string,
    limit: Money,
  ): Promise<void> {
    // Update-then-insert rather than an upsert: PostgREST's upsert would ask for
    // UPDATE on the key columns, which the grant deliberately withholds.
    const updated = await this.db
      .from('budget_category_limits')
      .update({ limit_minor: toWire(limit) })
      .eq('budget_period_id', periodId)
      .eq('category_id', categoryId)
      .select('id')
    if (updated.error) fail(updated.error, { operation: 'update', entity: 'budget' })
    if (updated.data.length > 0) return

    const inserted = await this.db.from('budget_category_limits').insert({
      user_id: userId,
      budget_period_id: periodId,
      category_id: categoryId,
      limit_minor: toWire(limit),
    })
    if (inserted.error) fail(inserted.error, { operation: 'insert', entity: 'budget' })
  }

  async removeCategoryLimit(periodId: string, categoryId: string): Promise<void> {
    const { error } = await this.db
      .from('budget_category_limits')
      .delete()
      .eq('budget_period_id', periodId)
      .eq('category_id', categoryId)
    if (error) fail(error, { operation: 'delete', entity: 'budget' })
  }
}
