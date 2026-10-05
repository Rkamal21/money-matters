import type { Category, CategoryKind, CategoryTreatment } from '@/domain/transactions/types'

import { mapCategory } from '../mappers/rows'
import type { Db } from '../supabase/client'
import type { Database } from '../supabase/database.types'
import { fail } from '../supabase/mapErrors'

export interface NewCategory {
  readonly name: string
  readonly kind: CategoryKind
  readonly treatment: CategoryTreatment
  readonly icon: string
  readonly color: string
  readonly position?: number
}

export interface CategoryPatch {
  readonly name?: string
  readonly treatment?: CategoryTreatment
  readonly icon?: string
  readonly color?: string
  readonly isArchived?: boolean
  readonly position?: number
}

export interface CategoryRepository {
  list(userId: string): Promise<Category[]>
  /** The slug is derived server-side from the name; the client never sends one. */
  create(userId: string, input: NewCategory): Promise<Category>
  update(id: string, patch: CategoryPatch): Promise<Category>
  /** Refused for a built-in category, or one in use — archive instead. */
  remove(id: string): Promise<void>
  reorder(orderedIds: readonly string[]): Promise<void>
}

export class SupabaseCategoryRepository implements CategoryRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async list(userId: string): Promise<Category[]> {
    const { data, error } = await this.db
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .order('kind', { ascending: true })
      .order('position', { ascending: true })
      .order('name', { ascending: true })
    if (error) fail(error, { operation: 'read', entity: 'category' })
    return data.map(mapCategory)
  }

  async create(userId: string, input: NewCategory): Promise<Category> {
    const row: Database['public']['Tables']['categories']['Insert'] = {
      user_id: userId,
      name: input.name.trim(),
      kind: input.kind,
      treatment: input.treatment,
      icon: input.icon,
      color: input.color,
      position: input.position ?? 100,
    } as Database['public']['Tables']['categories']['Insert']
    // `slug` is required by the generated Insert type but absent from the
    // client's grant: the BEFORE INSERT trigger derives it (DATABASE.md §6.3).
    const { data, error } = await this.db.from('categories').insert(row).select('*').single()
    if (error) fail(error, { operation: 'insert', entity: 'category' })
    return mapCategory(data)
  }

  async update(id: string, patch: CategoryPatch): Promise<Category> {
    const row: Database['public']['Tables']['categories']['Update'] = {}
    if (patch.name !== undefined) row.name = patch.name.trim()
    if (patch.treatment !== undefined) row.treatment = patch.treatment
    if (patch.icon !== undefined) row.icon = patch.icon
    if (patch.color !== undefined) row.color = patch.color
    if (patch.isArchived !== undefined) row.is_archived = patch.isArchived
    if (patch.position !== undefined) row.position = patch.position
    const { data, error } = await this.db
      .from('categories')
      .update(row)
      .eq('id', id)
      .select('*')
      .single()
    if (error) fail(error, { operation: 'update', entity: 'category' })
    return mapCategory(data)
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('categories').delete().eq('id', id)
    if (error) fail(error, { operation: 'delete', table: 'categories', entity: 'category' })
  }

  async reorder(orderedIds: readonly string[]): Promise<void> {
    const results = await Promise.all(
      orderedIds.map((id, index) =>
        this.db
          .from('categories')
          .update({ position: index + 1 })
          .eq('id', id),
      ),
    )
    const failed = results.find((result) => result.error !== null)
    if (failed?.error) fail(failed.error, { operation: 'update', entity: 'category' })
  }
}
