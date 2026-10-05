import type { Repositories } from '@/data/repositories'
import type { Transaction } from '@/domain/transactions/types'
import { toAppError } from '@/lib/errors'

import type { Outbox } from '../outbox/outbox'

import { createRequestOf, type SaveInput, saveTransaction } from './saveTransaction'

export type SaveOutcome =
  | { readonly status: 'saved'; readonly transaction: Transaction }
  /** No connection: kept in the outbox, written when the connection is back. */
  | { readonly status: 'queued'; readonly durable: boolean }

/**
 * `saveTransaction`, except that a *new* transaction that fails only because
 * the network is down is kept in the outbox instead of being lost
 * (ARCHITECTURE.md §M.2). Every other failure — and any failure of an edit —
 * reaches the form exactly as before.
 *
 * A network error does not prove the insert never arrived: the response may be
 * what was lost. The replay reuses the same `clientRequestId`, so that case
 * still ends with one row.
 */
export async function saveOrQueue(
  input: SaveInput,
  deps: Pick<Repositories, 'transactions' | 'merchantRules'>,
  outbox: Outbox,
  now: () => number,
): Promise<SaveOutcome> {
  try {
    return { status: 'saved', transaction: await saveTransaction(input, deps) }
  } catch (error) {
    if (input.existing !== null || toAppError(error).kind !== 'network') throw error
    await outbox.add(createRequestOf(input), now())
    return { status: 'queued', durable: outbox.durable }
  }
}
