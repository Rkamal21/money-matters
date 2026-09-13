import type { Goal, GoalWithProgress } from '@/domain/goals/Goal'
import { toWire, type Money } from '@/domain/money/Money'
import { toISO, type LocalDate } from '@/domain/period/LocalDate'

import { mapGoal, mapGoalWithProgress } from '../mappers/rows'
import type { Db } from '../supabase/client'
import type { Database } from '../supabase/database.types'
import { concurrentEditError, fail } from '../supabase/mapErrors'

/**
 * Goals — API.md §2.7, ADR-0026. There is no `setGoalAmount` and no
 * `addContribution`: a goal stores no amount, and a contribution is a transfer
 * written through the transaction repository.
 */

export interface NewGoal {
  readonly name: string
  readonly target: Money
  readonly walletAccountId: string
  readonly targetDate?: LocalDate | null
  readonly priority?: number
}

export interface GoalPatch {
  readonly name?: string
  readonly target?: Money
  readonly targetDate?: LocalDate | null
  readonly priority?: number
  readonly archivedAt?: string | null
}

export interface GoalRepository {
  list(userId: string): Promise<GoalWithProgress[]>
  getById(userId: string, id: string): Promise<GoalWithProgress | null>
  create(userId: string, input: NewGoal): Promise<Goal>
  update(id: string, patch: GoalPatch, expectedUpdatedAt?: string): Promise<Goal>
  remove(id: string): Promise<void>
}

const PROGRESS_COLUMNS = 'goal_id, balance_minor, reached, reached_on, currency_code'

export class SupabaseGoalRepository implements GoalRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async list(userId: string): Promise<GoalWithProgress[]> {
    const [goals, progress] = await Promise.all([
      this.db
        .from('goals')
        .select('*')
        .eq('user_id', userId)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true }),
      this.db.from('goal_progress').select(PROGRESS_COLUMNS).eq('user_id', userId),
    ])
    if (goals.error) fail(goals.error, { operation: 'read', entity: 'goal' })
    if (progress.error) fail(progress.error, { operation: 'read', entity: 'goal' })

    const byGoal = new Map(progress.data.map((row) => [row.goal_id, row]))
    return goals.data.map((row) => mapGoalWithProgress(row, byGoal.get(row.id)))
  }

  async getById(userId: string, id: string): Promise<GoalWithProgress | null> {
    const [goal, progress] = await Promise.all([
      this.db.from('goals').select('*').eq('user_id', userId).eq('id', id).maybeSingle(),
      this.db
        .from('goal_progress')
        .select(PROGRESS_COLUMNS)
        .eq('user_id', userId)
        .eq('goal_id', id)
        .maybeSingle(),
    ])
    if (goal.error) fail(goal.error, { operation: 'read', entity: 'goal' })
    if (progress.error) fail(progress.error, { operation: 'read', entity: 'goal' })
    return goal.data === null ? null : mapGoalWithProgress(goal.data, progress.data ?? undefined)
  }

  async create(userId: string, input: NewGoal): Promise<Goal> {
    const row: Database['public']['Tables']['goals']['Insert'] = {
      user_id: userId,
      wallet_account_id: input.walletAccountId,
      name: input.name.trim(),
      target_minor: toWire(input.target),
      target_date: input.targetDate ? toISO(input.targetDate) : null,
      priority: input.priority ?? 100,
    }
    const { data, error } = await this.db.from('goals').insert(row).select('*').single()
    if (error) fail(error, { operation: 'insert', entity: 'goal' })
    return mapGoal(data, input.target.currency)
  }

  async update(id: string, patch: GoalPatch, expectedUpdatedAt?: string): Promise<Goal> {
    const row: Database['public']['Tables']['goals']['Update'] = {}
    if (patch.name !== undefined) row.name = patch.name.trim()
    if (patch.target !== undefined) row.target_minor = toWire(patch.target)
    if (patch.targetDate !== undefined)
      row.target_date = patch.targetDate ? toISO(patch.targetDate) : null
    if (patch.priority !== undefined) row.priority = patch.priority
    if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt

    let query = this.db.from('goals').update(row).eq('id', id)
    if (expectedUpdatedAt !== undefined) query = query.eq('updated_at', expectedUpdatedAt)
    const { data, error } = await query.select('*').maybeSingle()
    if (error) fail(error, { operation: 'update', entity: 'goal' })
    if (data === null) throw concurrentEditError('goal')
    return mapGoal(data, patch.target?.currency ?? 'INR')
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('goals').delete().eq('id', id)
    if (error) fail(error, { operation: 'delete', entity: 'goal' })
  }
}
