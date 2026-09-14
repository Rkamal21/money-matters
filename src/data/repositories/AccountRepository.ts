import { toWire, type Money } from '@/domain/money/Money'
import type { Account, AccountType, AccountWithBalance } from '@/domain/transactions/types'

import { mapAccount, withBalance } from '../mappers/rows'
import type { Db } from '../supabase/client'
import type { Database } from '../supabase/database.types'
import { concurrentEditError, fail } from '../supabase/mapErrors'

export interface NewAccount {
  readonly name: string
  readonly type: AccountType
  readonly currency: string
  readonly openingBalance: Money
  readonly creditLimit?: Money | null
  readonly institution?: string | null
  readonly last4?: string | null
  readonly position?: number
}

export interface AccountPatch {
  readonly name?: string
  readonly type?: AccountType
  readonly openingBalance?: Money
  readonly creditLimit?: Money | null
  readonly institution?: string | null
  readonly last4?: string | null
  readonly isArchived?: boolean
  readonly position?: number
}

export interface AccountRepository {
  /** Every account, archived included, each with its derived balance. */
  list(userId: string): Promise<AccountWithBalance[]>
  create(userId: string, input: NewAccount): Promise<Account>
  update(id: string, patch: AccountPatch, expectedUpdatedAt?: string): Promise<Account>
  /** Refused with `account.in_use` when the account has history — archive it instead. */
  remove(id: string): Promise<void>
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export class SupabaseAccountRepository implements AccountRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async list(userId: string): Promise<AccountWithBalance[]> {
    // Balances come from the view, never from a stored column and never from
    // summing rows in the browser (API.md §2.3).
    const [accounts, balances] = await Promise.all([
      this.db
        .from('accounts')
        .select('*')
        .eq('user_id', userId)
        .order('position', { ascending: true })
        .order('name', { ascending: true }),
      this.db.from('account_balances').select('account_id, balance_minor').eq('user_id', userId),
    ])
    if (accounts.error) fail(accounts.error, { operation: 'read', entity: 'account' })
    if (balances.error) fail(balances.error, { operation: 'read', entity: 'account' })

    const byId = new Map(balances.data.map((row) => [row.account_id, row.balance_minor]))
    return accounts.data.map((row) => withBalance(mapAccount(row), byId.get(row.id)))
  }

  async create(userId: string, input: NewAccount): Promise<Account> {
    const row: Database['public']['Tables']['accounts']['Insert'] = {
      user_id: userId,
      name: input.name.trim(),
      type: input.type,
      currency_code: input.currency,
      opening_balance_minor: toWire(input.openingBalance),
      credit_limit_minor:
        input.type === 'credit_card' && input.creditLimit ? toWire(input.creditLimit) : null,
      institution: blankToNull(input.institution),
      last4: blankToNull(input.last4),
      position: input.position ?? 0,
    }
    const { data, error } = await this.db.from('accounts').insert(row).select('*').single()
    if (error) fail(error, { operation: 'insert', entity: 'account' })
    return mapAccount(data)
  }

  async update(id: string, patch: AccountPatch, expectedUpdatedAt?: string): Promise<Account> {
    const row: Database['public']['Tables']['accounts']['Update'] = {}
    if (patch.name !== undefined) row.name = patch.name.trim()
    if (patch.type !== undefined) row.type = patch.type
    if (patch.openingBalance !== undefined) row.opening_balance_minor = toWire(patch.openingBalance)
    if (patch.creditLimit !== undefined) {
      row.credit_limit_minor = patch.creditLimit === null ? null : toWire(patch.creditLimit)
    }
    if (patch.institution !== undefined) row.institution = blankToNull(patch.institution)
    if (patch.last4 !== undefined) row.last4 = blankToNull(patch.last4)
    if (patch.isArchived !== undefined) row.is_archived = patch.isArchived
    if (patch.position !== undefined) row.position = patch.position

    let query = this.db.from('accounts').update(row).eq('id', id)
    if (expectedUpdatedAt !== undefined) query = query.eq('updated_at', expectedUpdatedAt)
    const { data, error } = await query.select('*').maybeSingle()
    if (error) fail(error, { operation: 'update', entity: 'account' })
    if (data === null) throw concurrentEditError('account')
    return mapAccount(data)
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('accounts').delete().eq('id', id)
    if (error) fail(error, { operation: 'delete', table: 'accounts', entity: 'account' })
  }
}
