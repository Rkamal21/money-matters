import type { WalletEntry } from '@/domain/goals/goals'
import { toWire, type Money } from '@/domain/money/Money'
import { toISO, type LocalDate } from '@/domain/period/LocalDate'
import type { Transaction, TransactionKind } from '@/domain/transactions/types'

import { date, mapTransaction, money } from '../mappers/rows'
import type { Db } from '../supabase/client'
import type { Database } from '../supabase/database.types'
import { concurrentEditError, fail } from '../supabase/mapErrors'

import type { Page } from './types'

/**
 * The ledger's repository — API.md §2.5 and §3.
 *
 *   - Keyset pagination on (occurred_on desc, id desc), never OFFSET, which
 *     drifts as rows are inserted (ARCHITECTURE.md §L).
 *   - Creation is idempotent on `client_request_id`: the second submit of the
 *     same form returns the first row (DATABASE.md §12).
 *   - Edits are guarded by `updated_at`: last-write-wins is not acceptable on
 *     money.
 */

const SELECT = '*, transaction_splits(id, category_id, amount_minor, note)'
const PAGE_SIZE = 50

export interface TransactionFilter {
  readonly from?: LocalDate | null
  readonly to?: LocalDate | null
  readonly kinds?: readonly TransactionKind[]
  readonly categoryIds?: readonly string[]
  readonly accountIds?: readonly string[]
  readonly query?: string
}

export interface NewTransaction {
  readonly kind: TransactionKind
  readonly amount: Money
  readonly accountId: string
  readonly counterAccountId?: string | null
  readonly categoryId?: string | null
  readonly merchantLabel?: string | null
  readonly description?: string
  readonly notes?: string | null
  readonly occurredOn: LocalDate
  /** Generated once per form submission and reused on every retry. */
  readonly clientRequestId: string
  readonly refundOfTransactionId?: string | null
}

export interface TransactionPatch {
  readonly kind?: TransactionKind
  readonly amount?: Money
  readonly accountId?: string
  readonly counterAccountId?: string | null
  readonly categoryId?: string | null
  readonly merchantLabel?: string | null
  readonly description?: string
  readonly notes?: string | null
  readonly occurredOn?: LocalDate
}

export interface SplitPart {
  readonly categoryId: string
  readonly amount: Money
  readonly note?: string | null
}

export interface TransactionRepository {
  list(
    userId: string,
    filter: TransactionFilter,
    cursor?: string | null,
    limit?: number,
  ): Promise<Page<Transaction>>
  getById(userId: string, id: string): Promise<Transaction | null>
  create(userId: string, input: NewTransaction): Promise<Transaction>
  update(id: string, patch: TransactionPatch, expectedUpdatedAt?: string): Promise<Transaction>
  softDelete(id: string): Promise<void>
  restore(id: string): Promise<void>
  /** Swap the parts atomically. An empty list un-splits onto `fallbackCategoryId`. */
  replaceSplits(id: string, parts: readonly SplitPart[], fallbackCategoryId?: string): Promise<void>
  /** Signed entries on one account since a date — a goal wallet's activity (ADR-0026). */
  accountEntries(userId: string, accountId: string, since: LocalDate): Promise<WalletEntry[]>
}

/** PostgREST's logical-filter syntax reserves these; a search term may not smuggle them in. */
function sanitiseSearch(term: string): string {
  return term
    .replace(/[,()*:"\\%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function encodeCursor(row: { readonly occurred_on: string; readonly id: string }): string {
  return `${row.occurred_on}_${row.id}`
}

function decodeCursor(cursor: string): { date: string; id: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})_([0-9a-f-]{36})$/.exec(cursor)
  return match?.[1] !== undefined && match[2] !== undefined
    ? { date: match[1], id: match[2] }
    : null
}

export class SupabaseTransactionRepository implements TransactionRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async list(
    userId: string,
    filter: TransactionFilter,
    cursor: string | null = null,
    limit = PAGE_SIZE,
  ): Promise<Page<Transaction>> {
    let query = this.db
      .from('transactions')
      .select(SELECT)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .eq('status', 'confirmed')

    if (filter.from) query = query.gte('occurred_on', toISO(filter.from))
    if (filter.to) query = query.lte('occurred_on', toISO(filter.to))
    if (filter.kinds && filter.kinds.length > 0) query = query.in('kind', [...filter.kinds])

    // Every OR-group is combined into a single `or` parameter, ANDed together.
    const groups: string[] = []

    if (filter.accountIds && filter.accountIds.length > 0) {
      const ids = filter.accountIds.join(',')
      groups.push(`account_id.in.(${ids}),counter_account_id.in.(${ids})`)
    }

    if (filter.categoryIds && filter.categoryIds.length > 0) {
      // A split transaction has no direct category; find it through its parts.
      const splitIds = await this.transactionIdsWithSplitCategory(userId, filter.categoryIds)
      const categoryIds = filter.categoryIds.join(',')
      groups.push(
        splitIds.length > 0
          ? `category_id.in.(${categoryIds}),id.in.(${splitIds.join(',')})`
          : `category_id.in.(${categoryIds})`,
      )
    }

    const term = sanitiseSearch(filter.query ?? '')
    if (term !== '') groups.push(`description.ilike.*${term}*,merchant_label.ilike.*${term}*`)

    const position = cursor === null ? null : decodeCursor(cursor)
    if (position !== null) {
      groups.push(
        `occurred_on.lt.${position.date},and(occurred_on.eq.${position.date},id.lt.${position.id})`,
      )
    }

    if (groups.length === 1 && groups[0] !== undefined) {
      query = query.or(groups[0])
    } else if (groups.length > 1) {
      query = query.or(`and(${groups.map((group) => `or(${group})`).join(',')})`)
    }

    const { data, error } = await query
      .order('occurred_on', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)
    if (error) fail(error, { operation: 'read', entity: 'transaction' })

    const rows = data.slice(0, limit)
    const last = rows[rows.length - 1]
    return {
      items: rows.map(mapTransaction),
      nextCursor: data.length > limit && last !== undefined ? encodeCursor(last) : null,
    }
  }

  private async transactionIdsWithSplitCategory(
    userId: string,
    categoryIds: readonly string[],
  ): Promise<string[]> {
    const { data, error } = await this.db
      .from('transaction_splits')
      .select('transaction_id')
      .eq('user_id', userId)
      .in('category_id', [...categoryIds])
      .limit(500)
    if (error) fail(error, { operation: 'read', entity: 'transaction' })
    return [...new Set(data.map((row) => row.transaction_id))]
  }

  async getById(userId: string, id: string): Promise<Transaction | null> {
    const { data, error } = await this.db
      .from('transactions')
      .select(SELECT)
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle()
    if (error) fail(error, { operation: 'read', entity: 'transaction' })
    return data === null ? null : mapTransaction(data)
  }

  private async byClientRequestId(
    userId: string,
    clientRequestId: string,
  ): Promise<Transaction | null> {
    const { data, error } = await this.db
      .from('transactions')
      .select(SELECT)
      .eq('user_id', userId)
      .eq('client_request_id', clientRequestId)
      .maybeSingle()
    if (error) fail(error, { operation: 'read', entity: 'transaction' })
    return data === null ? null : mapTransaction(data)
  }

  async create(userId: string, input: NewTransaction): Promise<Transaction> {
    const row: Database['public']['Tables']['transactions']['Insert'] = {
      user_id: userId,
      kind: input.kind,
      amount_minor: toWire(input.amount),
      currency_code: input.amount.currency,
      account_id: input.accountId,
      counter_account_id: input.kind === 'transfer' ? (input.counterAccountId ?? null) : null,
      category_id: input.kind === 'transfer' ? null : (input.categoryId ?? null),
      merchant_label: input.merchantLabel?.trim() || null,
      description: (input.description ?? '').trim(),
      notes: input.notes?.trim() || null,
      occurred_on: toISO(input.occurredOn),
      client_request_id: input.clientRequestId,
      refund_of_transaction_id:
        input.kind === 'refund' ? (input.refundOfTransactionId ?? null) : null,
    }

    const { data, error } = await this.db.from('transactions').insert(row).select(SELECT).single()
    if (error) {
      // The same submit twice is one row: return the one already saved (DATABASE.md §12).
      if (
        error.code === '23505' &&
        `${error.message} ${error.details}`.includes('tx_client_request_uk')
      ) {
        const existing = await this.byClientRequestId(userId, input.clientRequestId)
        if (existing !== null) return existing
      }
      fail(error, { operation: 'insert', entity: 'transaction' })
    }
    return mapTransaction(data)
  }

  async update(
    id: string,
    patch: TransactionPatch,
    expectedUpdatedAt?: string,
  ): Promise<Transaction> {
    const row: Database['public']['Tables']['transactions']['Update'] = {}
    if (patch.kind !== undefined) row.kind = patch.kind
    if (patch.amount !== undefined) {
      row.amount_minor = toWire(patch.amount)
      row.currency_code = patch.amount.currency
    }
    if (patch.accountId !== undefined) row.account_id = patch.accountId
    if (patch.counterAccountId !== undefined) row.counter_account_id = patch.counterAccountId
    if (patch.categoryId !== undefined) row.category_id = patch.categoryId
    if (patch.merchantLabel !== undefined) row.merchant_label = patch.merchantLabel?.trim() || null
    if (patch.description !== undefined) row.description = patch.description.trim()
    if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null
    if (patch.occurredOn !== undefined) row.occurred_on = toISO(patch.occurredOn)

    let query = this.db.from('transactions').update(row).eq('id', id)
    if (expectedUpdatedAt !== undefined) query = query.eq('updated_at', expectedUpdatedAt)
    const { data, error } = await query.select(SELECT).maybeSingle()
    if (error) fail(error, { operation: 'update', entity: 'transaction' })
    if (data === null) throw concurrentEditError('transaction')
    return mapTransaction(data)
  }

  async softDelete(id: string): Promise<void> {
    const { error } = await this.db
      .from('transactions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) fail(error, { operation: 'update', entity: 'transaction' })
  }

  async restore(id: string): Promise<void> {
    const { error } = await this.db.from('transactions').update({ deleted_at: null }).eq('id', id)
    if (error) fail(error, { operation: 'update', entity: 'transaction' })
  }

  async replaceSplits(
    id: string,
    parts: readonly SplitPart[],
    fallbackCategoryId?: string,
  ): Promise<void> {
    const { error } = await this.db.rpc('replace_transaction_splits', {
      p_transaction_id: id,
      p_splits: parts.map((part) => ({
        category_id: part.categoryId,
        amount_minor: toWire(part.amount),
        note: part.note ?? null,
      })),
      ...(fallbackCategoryId === undefined ? {} : { p_category_id: fallbackCategoryId }),
    })
    if (error) fail(error, { operation: 'rpc', entity: 'transaction' })
  }

  async accountEntries(
    userId: string,
    accountId: string,
    since: LocalDate,
  ): Promise<WalletEntry[]> {
    const { data, error } = await this.db
      .from('account_entries')
      .select('occurred_on, signed_amount_minor, currency_code')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .gte('occurred_on', toISO(since))
      .order('occurred_on', { ascending: true })
      .limit(1000)
    if (error) fail(error, { operation: 'read', entity: 'transaction' })
    return data.flatMap((row) =>
      row.occurred_on === null || row.signed_amount_minor === null || row.currency_code === null
        ? []
        : [
            {
              occurredOn: date(row.occurred_on),
              amount: money(row.signed_amount_minor, row.currency_code),
            },
          ],
    )
  }
}
