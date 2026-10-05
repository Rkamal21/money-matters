import type { Achievement, GamificationProfile, XpEvent } from '@/domain/gamification/types'
import { toISO, type LocalDate } from '@/domain/period/LocalDate'

import { mapAchievement, mapGamificationProfile, mapXpEvent } from '../mappers/rows'
import type { Db } from '../supabase/client'
import { fail } from '../supabase/mapErrors'

/**
 * Gamification — API.md §2.8. There is no `awardXp`: no client-callable path
 * grants XP. Every award is a trigger or a definer function (ADR-0016).
 */
export interface GamificationRepository {
  getProfile(userId: string): Promise<GamificationProfile | null>
  checkIn(today: LocalDate): Promise<GamificationProfile>
  listAchievements(userId: string): Promise<Achievement[]>
  listEvents(userId: string, limit?: number): Promise<XpEvent[]>
}

export class SupabaseGamificationRepository implements GamificationRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async getProfile(userId: string): Promise<GamificationProfile | null> {
    const { data, error } = await this.db
      .from('gamification_profiles')
      .select('xp_total, current_streak, longest_streak, last_check_in_on')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) fail(error, { operation: 'read', entity: 'gamification' })
    return data === null ? null : mapGamificationProfile(data)
  }

  async checkIn(today: LocalDate): Promise<GamificationProfile> {
    const { data, error } = await this.db.rpc('daily_check_in', { p_today: toISO(today) })
    if (error) fail(error, { operation: 'rpc', entity: 'gamification' })
    return mapGamificationProfile(data)
  }

  async listAchievements(userId: string): Promise<Achievement[]> {
    const [catalog, unlocked] = await Promise.all([
      this.db.from('achievements').select('*').order('sort_order', { ascending: true }),
      this.db
        .from('user_achievements')
        .select('achievement_code, unlocked_at')
        .eq('user_id', userId),
    ])
    if (catalog.error) fail(catalog.error, { operation: 'read', entity: 'gamification' })
    if (unlocked.error) fail(unlocked.error, { operation: 'read', entity: 'gamification' })
    const at = new Map(unlocked.data.map((row) => [row.achievement_code, row.unlocked_at]))
    return catalog.data.map((row) => mapAchievement(row, at.get(row.code) ?? null))
  }

  async listEvents(userId: string, limit = 100): Promise<XpEvent[]> {
    const { data, error } = await this.db
      .from('gamification_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) fail(error, { operation: 'read', entity: 'gamification' })
    return data.map(mapXpEvent)
  }
}
