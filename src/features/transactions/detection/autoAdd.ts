import type { Repositories } from '@/data/repositories'
import type { LocalDate } from '@/domain/period/LocalDate'
import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import {
  autoAddAccount,
  autoAddCategory,
  candidateHolds,
  type HoldReason,
  ledgerHolds,
  ledgerWindow,
  withCurrentRules,
} from '@/domain/transactions/ingest/autoAdd'
import type { AccountWithBalance, Category, Transaction } from '@/domain/transactions/types'
import { addedNoticeFor, noticeFor } from '@/platform/sms/notice'
import type { Detection, SmsCapturePort } from '@/platform/sms/smsCapture'

import { saveTransaction } from '../services/saveTransaction'

import { checkDraft, draftFromCandidate, toSaveInput } from './reviewDraft'

/**
 * Adds the detections nothing needs a person for (ADR-0015 as amended on
 * 2026-10-04). Runs in the app — when it opens, resumes, or hears of a new
 * detection — because the ledger can only be written from here: through
 * `saveTransaction`, the entry form's own write path, with the confirmation
 * key derived from the message, so a detection added twice is one row.
 *
 * For each pending detection, oldest first:
 *   already in the ledger   finished quietly: a pass that stopped half-way,
 *                           or a message the user confirmed earlier
 *   clear                   added, its origin recorded (an imported message
 *                           older than its account also moves the opening
 *                           balance, server-side, exactly once), and settled
 *   anything to ask         held for review, its notification reworded
 *
 * A detection is removed from the device queue only after its row and origin
 * are both written, so a pass that fails part-way is finished by the next.
 */

export interface AutoAddInput {
  readonly userId: string
  readonly accounts: readonly AccountWithBalance[]
  readonly categories: readonly Category[]
  readonly rules: readonly CategoryRule[]
  readonly today: LocalDate
  readonly currency: string
  /** The user's switch. Off: nothing is added; detections still finish if already added. */
  readonly enabled: boolean
}

export interface AutoAddDeps {
  readonly repositories: Pick<Repositories, 'transactions' | 'merchantRules'>
  readonly capture: Pick<SmsCapturePort, 'listPending' | 'settle' | 'hold'>
}

export interface AutoAddResult {
  readonly added: readonly { readonly detection: Detection; readonly transaction: Transaction }[]
  readonly held: readonly {
    readonly detection: Detection
    readonly reasons: readonly HoldReason[]
  }[]
  readonly alreadyAdded: readonly Detection[]
  /** Could not be finished this time (offline, say); still queued for the next pass. */
  readonly failed: readonly Detection[]
}

let tail: Promise<unknown> = Promise.resolve()

/**
 * Runs passes one after another — the listener's, and an import's — so two
 * never work on the same detection at once.
 */
export function exclusively<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task)
  tail = run.catch(() => undefined)
  return run
}

/** How many ledger rows the duplicate and transfer checks read around one date. */
const NEARBY_LIMIT = 500

export async function autoAddDetections(
  input: AutoAddInput,
  deps: AutoAddDeps,
): Promise<AutoAddResult> {
  const { transactions } = deps.repositories
  const result = {
    added: [] as { detection: Detection; transaction: Transaction }[],
    held: [] as { detection: Detection; reasons: HoldReason[] }[],
    alreadyAdded: [] as Detection[],
    failed: [] as Detection[],
  }
  const pending = await deps.capture.listPending()

  for (const detection of [...pending].reverse()) {
    try {
      const existing = await transactions.findByClientRequestId(input.userId, detection.requestId)
      if (existing !== null) {
        if (existing.deletedAt === null) await recordOrigin(deps, existing.id, detection)
        await deps.capture.settle(detection.id, null)
        result.alreadyAdded.push(detection)
        continue
      }

      const candidate = withCurrentRules(detection.candidate, input.rules, input.categories)
      const context = {
        enabled: input.enabled,
        currency: input.currency,
        accounts: input.accounts,
        categories: input.categories,
      }
      let reasons = candidateHolds(candidate, context)
      const account = autoAddAccount(candidate, input.accounts)
      const category = autoAddCategory(candidate, input.categories)
      const { kind, occurredOn } = candidate

      if (reasons.length === 0 && account !== null && kind !== null && occurredOn !== null) {
        const { from, to } = ledgerWindow(occurredOn)
        const nearby = await transactions.list(input.userId, { from, to }, null, NEARBY_LIMIT)
        reasons = ledgerHolds(
          {
            amount: candidate.amount,
            kind,
            occurredOn,
            accountId: account.id,
            merchant: candidate.merchant,
          },
          nearby.items,
        )
      }

      const check =
        reasons.length === 0 && account !== null
          ? checkDraft(
              {
                ...draftFromCandidate(candidate, {
                  accounts: input.accounts,
                  categories: input.categories,
                  today: input.today,
                  currency: input.currency,
                }),
                accountId: account.id,
              },
              { currency: input.currency, today: input.today },
            )
          : null
      if (check === null || !check.ok) {
        const held: HoldReason[] = reasons.length > 0 ? reasons : ['not_valid']
        if (detection.auto) await deps.capture.hold(detection.id, noticeFor(candidate))
        result.held.push({ detection, reasons: held })
        continue
      }

      const saved = await saveTransaction(
        toSaveInput(check.values, {
          userId: input.userId,
          candidate,
          rules: input.rules,
          categories: input.categories,
          currency: input.currency,
        }),
        deps.repositories,
      )
      await recordOrigin(deps, saved.id, detection)
      const categoryName =
        input.categories.find((option) => option.slug === category?.categorySlug)?.name ??
        'a category'
      await deps.capture.settle(
        detection.id,
        detection.source === 'import'
          ? null
          : { requestId: detection.requestId, notice: addedNoticeFor(candidate, categoryName) },
      )
      result.added.push({ detection, transaction: saved })
    } catch {
      result.failed.push(detection)
    }
  }
  return result
}

function recordOrigin(
  deps: AutoAddDeps,
  transactionId: string,
  detection: Detection,
): Promise<boolean> {
  return deps.repositories.transactions.recordOrigin(
    transactionId,
    detection.source,
    detection.source === 'import' ? detection.sentAt : null,
  )
}

export interface UndoResult {
  /** The row Undo deleted; `null` when the detection had not been added yet. */
  readonly removed: Transaction | null
}

/**
 * The notification's Undo: the detection leaves the queue (if it was still
 * waiting, nothing was ever written), and a row already added is deleted. The
 * message's fingerprint stays remembered on the device, so it does not come
 * back.
 */
export async function undoDetection(
  opened: { readonly id: string; readonly requestId: string | null },
  userId: string,
  deps: {
    readonly repositories: Pick<Repositories, 'transactions'>
    readonly capture: Pick<SmsCapturePort, 'remove'>
  },
): Promise<UndoResult> {
  await deps.capture.remove(opened.id)
  if (opened.requestId === null) return { removed: null }
  const saved = await deps.repositories.transactions.findByClientRequestId(userId, opened.requestId)
  if (saved === null || saved.deletedAt !== null) return { removed: null }
  await deps.repositories.transactions.softDelete(saved.id)
  return { removed: saved }
}
