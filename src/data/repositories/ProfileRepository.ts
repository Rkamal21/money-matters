import type { Profile } from '@/domain/profile/Profile'

import { mapProfile } from '../mappers/rows'
import type { Db } from '../supabase/client'
import type { Database } from '../supabase/database.types'
import { fail } from '../supabase/mapErrors'

export interface ProfilePatch {
  readonly displayName?: string
  readonly timezone?: string
  readonly currency?: string
  readonly locale?: string
  readonly budgetPeriodStartDay?: number
  readonly onboardingCompletedAt?: string | null
  readonly gamificationEnabled?: boolean
}

export interface ProfileRepository {
  get(userId: string): Promise<Profile>
  update(userId: string, patch: ProfilePatch): Promise<Profile>
}

export class SupabaseProfileRepository implements ProfileRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async get(userId: string): Promise<Profile> {
    const { data, error } = await this.db.from('profiles').select('*').eq('id', userId).single()
    if (error) fail(error, { operation: 'read', entity: 'profile' })
    return mapProfile(data)
  }

  async update(userId: string, patch: ProfilePatch): Promise<Profile> {
    // An explicit column list: a field not named here is never sent (SECURITY.md T6).
    const row: Database['public']['Tables']['profiles']['Update'] = {}
    if (patch.displayName !== undefined) row.display_name = patch.displayName.trim()
    if (patch.timezone !== undefined) row.timezone = patch.timezone
    if (patch.currency !== undefined) row.currency_code = patch.currency
    if (patch.locale !== undefined) row.locale = patch.locale
    if (patch.budgetPeriodStartDay !== undefined)
      row.budget_period_start_day = patch.budgetPeriodStartDay
    if (patch.onboardingCompletedAt !== undefined)
      row.onboarding_completed_at = patch.onboardingCompletedAt
    if (patch.gamificationEnabled !== undefined)
      row.gamification_enabled = patch.gamificationEnabled

    const { data, error } = await this.db
      .from('profiles')
      .update(row)
      .eq('id', userId)
      .select('*')
      .single()
    if (error) fail(error, { operation: 'update', entity: 'profile' })
    return mapProfile(data)
  }
}
