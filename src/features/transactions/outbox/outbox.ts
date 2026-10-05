import { fromStoredJson, toStoredJson } from '@/lib/storedJson'
import { deviceStore, type DeviceStore } from '@/platform/storage/deviceStore'

import type { CreateRequest } from '../services/saveTransaction'

/**
 * The write outbox — ARCHITECTURE.md §M.2. A new transaction submitted with no
 * connection waits here with its `clientRequestId` and is written when the
 * connection is back. That id is unique per user, so a replay that races a
 * lost response, a second tab, or a retry still makes one row.
 *
 * Only creates are queued. An edit or a delete offline fails as before:
 * replaying an edit later could overwrite a change made elsewhere, and
 * "this changed elsewhere" is a question for a person, not a queue.
 *
 * Where it lives: the app's private storage on Android, so a queued payment
 * survives the app being closed; memory on the web, where SECURITY.md T20
 * keeps financial data out of browser storage (a reload there loses the
 * queue, and the form says so).
 */

export interface OutboxFailure {
  readonly code: string
  readonly message: string
}

export interface OutboxEntry {
  /** The transaction's `clientRequestId`. */
  readonly id: string
  /** Epoch milliseconds. */
  readonly queuedAt: number
  readonly request: CreateRequest
  /** Set when the server refused the write for a reason a retry cannot fix. */
  readonly failure: OutboxFailure | null
}

export interface Outbox {
  /** Every user's entries, oldest first. The same array until something changes. */
  snapshot(): readonly OutboxEntry[]
  subscribe(listener: () => void): () => void
  /** Resolves once entries kept on the device have been read. */
  ready(): Promise<void>
  add(request: CreateRequest, queuedAt: number): Promise<void>
  remove(id: string): Promise<void>
  fail(id: string, failure: OutboxFailure): Promise<void>
  /** Whether entries survive the app being closed. */
  readonly durable: boolean
}

const KEY = 'mm.outbox.v1'

export function createOutbox(store: DeviceStore | null): Outbox {
  let entries: readonly OutboxEntry[] = []
  const listeners = new Set<() => void>()
  let writes: Promise<void> = Promise.resolve()

  const loaded: Promise<void> =
    store === null
      ? Promise.resolve()
      : store
          .get(KEY)
          .then((text) => {
            const saved = text === null ? [] : readEntries(text)
            // Anything added while the device store was being read stays too.
            const fresh = entries.filter((entry) => !saved.some((s) => s.id === entry.id))
            entries = [...saved, ...fresh]
            notify()
          })
          .catch(() => undefined)

  function notify() {
    for (const listener of listeners) listener()
  }

  async function commit(next: readonly OutboxEntry[]) {
    entries = next
    notify()
    if (store === null) return
    const text = toStoredJson(next)
    // Writes go in order, so an older list never lands after a newer one.
    writes = writes.then(() => store.set(KEY, text)).catch(() => undefined)
    await writes
  }

  return {
    durable: store !== null,
    snapshot: () => entries,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ready: () => loaded,
    async add(request, queuedAt) {
      await loaded
      const id = request.transaction.clientRequestId
      if (entries.some((entry) => entry.id === id)) return
      await commit([...entries, { id, queuedAt, request, failure: null }])
    },
    async remove(id) {
      await loaded
      await commit(entries.filter((entry) => entry.id !== id))
    },
    async fail(id, failure) {
      await loaded
      await commit(entries.map((entry) => (entry.id === id ? { ...entry, failure } : entry)))
    },
  }
}

/**
 * Entries read back from the device arrive as `unknown` (API.md §2): anything
 * that is not recognisably an entry is dropped rather than sent to the server.
 */
function readEntries(text: string): OutboxEntry[] {
  try {
    const value = fromStoredJson(text)
    return Array.isArray(value) ? value.filter(isEntry) : []
  } catch {
    return []
  }
}

function isEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<OutboxEntry>
  const transaction = entry.request?.transaction
  return (
    typeof entry.id === 'string' &&
    typeof entry.queuedAt === 'number' &&
    typeof entry.request?.userId === 'string' &&
    transaction !== undefined &&
    transaction.clientRequestId === entry.id &&
    typeof transaction.amount?.minor === 'bigint' &&
    typeof transaction.amount.currency === 'string'
  )
}

/** The app's one outbox. */
export const outbox: Outbox = createOutbox(deviceStore())
