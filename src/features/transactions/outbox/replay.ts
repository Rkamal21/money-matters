import type { Repositories } from '@/data/repositories'
import { toAppError } from '@/lib/errors'

import { writeCreate } from '../services/saveTransaction'

import type { Outbox } from './outbox'

export interface ReplayResult {
  /** Entries written to the ledger. */
  readonly added: number
  /** Entries the server refused for a reason a retry cannot fix. */
  readonly failed: number
  /** Still waiting: no connection, or no session to write with. */
  readonly waiting: number
}

/**
 * Writes one user's queued transactions, oldest first, through the same
 * `writeCreate` the form uses. Stops at the first error a later try could fix
 * — offline, rate limited, or signed out — and leaves the rest queued. An
 * error that a retry cannot fix (the account was deleted meanwhile, say) is
 * recorded on its entry for the person to see, and the queue moves on.
 */
export async function replayOutbox(
  userId: string,
  outbox: Outbox,
  deps: Pick<Repositories, 'transactions'>,
): Promise<ReplayResult> {
  await outbox.ready()
  const queued = outbox
    .snapshot()
    .filter((entry) => entry.request.userId === userId && entry.failure === null)

  let added = 0
  let failed = 0
  for (const [index, entry] of queued.entries()) {
    try {
      await writeCreate(entry.request, deps)
      await outbox.remove(entry.id)
      added += 1
    } catch (error) {
      const appError = toAppError(error)
      if (appError.retryable || appError.kind === 'authentication') {
        return { added, failed, waiting: queued.length - index }
      }
      await outbox.fail(entry.id, { code: appError.code, message: appError.userMessage })
      failed += 1
    }
  }
  return { added, failed, waiting: 0 }
}
