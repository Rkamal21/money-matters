import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'

import { mapMerchantRule } from '../mappers/rows'
import type { Db } from '../supabase/client'
import { fail } from '../supabase/mapErrors'

export type LearnedRule = Pick<
  CategoryRule,
  'pattern' | 'matchType' | 'merchantLabel' | 'categorySlug' | 'confidence' | 'priority'
>

export interface MerchantRuleRepository {
  /** System rules plus the user's own; RLS decides which. */
  list(): Promise<CategoryRule[]>
  /** Write, or rewrite, the user's personal rule for a pattern (API.md §2.10 "learn"). */
  saveUserRule(userId: string, rule: LearnedRule): Promise<void>
  remove(id: string): Promise<void>
}

export class SupabaseMerchantRuleRepository implements MerchantRuleRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async list(): Promise<CategoryRule[]> {
    const { data, error } = await this.db
      .from('merchant_rules')
      .select('*')
      .eq('is_enabled', true)
      .order('priority', { ascending: true })
      .limit(1000)
    if (error) fail(error, { operation: 'read', entity: 'merchant_rule' })
    return data.map(mapMerchantRule)
  }

  async saveUserRule(userId: string, rule: LearnedRule): Promise<void> {
    const existing = await this.db
      .from('merchant_rules')
      .select('id')
      .eq('user_id', userId)
      .eq('pattern', rule.pattern)
      .eq('match_type', rule.matchType)
      .maybeSingle()
    if (existing.error) fail(existing.error, { operation: 'read', entity: 'merchant_rule' })

    if (existing.data !== null) {
      const { error } = await this.db
        .from('merchant_rules')
        .update({
          category_slug: rule.categorySlug,
          merchant_label: rule.merchantLabel,
          confidence: rule.confidence,
          priority: rule.priority,
          is_enabled: true,
        })
        .eq('id', existing.data.id)
      if (error) fail(error, { operation: 'update', entity: 'merchant_rule' })
      return
    }

    const { error } = await this.db.from('merchant_rules').insert({
      user_id: userId,
      pattern: rule.pattern,
      match_type: rule.matchType,
      merchant_label: rule.merchantLabel,
      category_slug: rule.categorySlug,
      confidence: rule.confidence,
      priority: rule.priority,
    })
    if (error) fail(error, { operation: 'insert', entity: 'merchant_rule' })
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('merchant_rules').delete().eq('id', id)
    if (error) fail(error, { operation: 'delete', entity: 'merchant_rule' })
  }
}
