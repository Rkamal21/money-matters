import { Capacitor, type PermissionState, registerPlugin } from '@capacitor/core'

import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import type { AutoAddAccount } from '@/domain/transactions/ingest/autoAdd'
import { confirmationRequestId } from '@/domain/transactions/ingest/review'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'
import type { Category } from '@/domain/transactions/types'

import type { DetectionNotice } from './notice'
import { candidateFromJSON } from './readCandidate'

/**
 * The transaction-capture port (ARCHITECTURE.md §M.1, §M.3). Features use this,
 * never `@capacitor/*`.
 *
 * The Android side (android/app/src/main/java/com/moneymatters/app/sms)
 * receives a bank SMS, runs the app's own parser on it in a JavaScriptSandbox,
 * keeps the *candidate* — never the message — in an encrypted on-device queue,
 * and posts a notification. It can also import past messages from the inbox,
 * and read payment-app notifications (GPay, PhonePe, Paytm, bank apps) the
 * same way.
 * This port lists that queue, settles what the app added, holds what needs a
 * person, removes what the user confirmed, ignored or undid, and passes down
 * the context the receiver needs to categorise and mark clear transactions for
 * adding. On the web, and on devices without a JavaScript sandbox, it reports
 * the feature as unavailable and does nothing.
 */

export type Unavailable = 'not_android' | 'unsupported_device'

export interface SmsCaptureStatus {
  readonly available: boolean
  readonly unavailable: Unavailable | null
  /** The user turned detection on (and has not turned it off). */
  readonly enabled: boolean
  /** "Add clear transactions automatically". */
  readonly autoAdd: boolean
  readonly sms: PermissionState
  /** READ_SMS, for importing past messages. */
  readonly inbox: PermissionState
  readonly notifications: PermissionState
  /** The user turned on reading payment-app notifications. */
  readonly paymentApps: boolean
  /** Android's Notification access is granted to Money Matters. */
  readonly notificationAccess: boolean
}

/** Where a detection came from — and its `transactions.source` once added. */
export type DetectionSource = 'sms' | 'notification' | 'import'

export interface Detection {
  readonly id: string
  /** When it was detected on the phone, epoch ms. */
  readonly receivedAt: number
  /** When the message was sent, epoch ms. */
  readonly sentAt: number
  readonly source: DetectionSource
  /** Android marked it for adding without review; the app still checks the ledger first. */
  readonly auto: boolean
  /** Its ledger idempotency key (`confirmationRequestId`). */
  readonly requestId: string
  readonly candidate: TransactionCandidate
}

/** A detection's notification, or its Undo, was tapped. */
export interface OpenedDetection {
  readonly id: string
  readonly requestId: string | null
  readonly action: 'open' | 'undo'
}

export interface ImportCounts {
  /** Inbox messages in the period. */
  readonly messages: number
  /** Of those, from bank and payment senders. */
  readonly fromBanks: number
  /** New transactions found and queued. */
  readonly queued: number
  /** Already found — captured live or by an earlier import. */
  readonly alreadyFound: number
  /** OTPs, promotions, balance alerts and the like. */
  readonly notTransactions: number
}

/** What the receiver needs to categorise a message and decide whether it is clear enough to add. */
export interface CaptureContext {
  readonly rules: readonly CategoryRule[]
  readonly categories: readonly Pick<Category, 'slug' | 'kind' | 'name' | 'isArchived'>[]
  readonly currency: string
  readonly accounts: readonly AutoAddAccount[]
}

interface PermissionStates {
  readonly sms: PermissionState
  readonly inbox?: PermissionState
  readonly notifications: PermissionState
}

type NativeStatus = PermissionStates & {
  readonly supported: boolean
  readonly enabled: boolean
  readonly autoAdd?: boolean
  readonly paymentApps?: boolean
  readonly notificationAccess?: boolean
}

interface NativeDetection {
  readonly id: string
  readonly receivedAt: number
  readonly sentAt?: number
  readonly source?: string
  readonly auto?: boolean
  readonly requestId?: string
  readonly candidate: string
}

interface NativeOpened {
  readonly id?: string | null
  readonly requestId?: string | null
  readonly action?: string | null
}

interface NativeSmsCapture {
  getStatus(): Promise<NativeStatus>
  requestCapturePermissions(): Promise<PermissionStates>
  requestInboxPermission(): Promise<PermissionStates>
  setEnabled(options: { enabled: boolean }): Promise<void>
  setAutoAdd(options: { enabled: boolean }): Promise<void>
  setPaymentApps(options: { enabled: boolean }): Promise<void>
  openNotificationAccess(): Promise<void>
  syncContext(options: {
    rules: string
    categories: string
    currency: string
    accounts: string
  }): Promise<void>
  listPending(): Promise<{ detections: readonly NativeDetection[] }>
  remove(options: { id: string }): Promise<void>
  settle(options: { id: string; requestId?: string; notice?: DetectionNotice }): Promise<void>
  hold(options: { id: string; notice: DetectionNotice }): Promise<void>
  importInbox(options: { days: number }): Promise<ImportCounts>
  takeOpenedDetection(): Promise<NativeOpened>
  openAppSettings(): Promise<void>
  addListener(
    event: 'detectionAdded' | 'detectionOpened',
    listener: (data: NativeOpened) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

const native = registerPlugin<NativeSmsCapture>('SmsCapture')

const isAndroid = (): boolean => Capacitor.getPlatform() === 'android'

const UNAVAILABLE_ON_WEB: SmsCaptureStatus = {
  available: false,
  unavailable: 'not_android',
  enabled: false,
  autoAdd: false,
  sms: 'denied',
  inbox: 'denied',
  notifications: 'denied',
  paymentApps: false,
  notificationAccess: false,
}

const SOURCES: ReadonlySet<string> = new Set<DetectionSource>(['sms', 'notification', 'import'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function statusFrom(native: NativeStatus): SmsCaptureStatus {
  return {
    available: native.supported,
    unavailable: native.supported ? null : 'unsupported_device',
    enabled: native.supported && native.enabled && native.sms === 'granted',
    autoAdd: native.autoAdd !== false,
    sms: native.sms,
    inbox: native.inbox ?? 'prompt',
    notifications: native.notifications,
    paymentApps: native.paymentApps === true,
    notificationAccess: native.notificationAccess === true,
  }
}

function openedFrom(data: NativeOpened): OpenedDetection | null {
  if (typeof data.id !== 'string' || data.id === '') return null
  return {
    id: data.id,
    requestId:
      typeof data.requestId === 'string' && UUID.test(data.requestId) ? data.requestId : null,
    action: data.action === 'undo' ? 'undo' : 'open',
  }
}

/** A queue record as the app can trust it, or `null` when it fails validation. */
function detectionFrom(record: NativeDetection): Detection | null {
  let candidate: TransactionCandidate | null
  try {
    candidate = candidateFromJSON(JSON.parse(record.candidate))
  } catch {
    candidate = null
  }
  if (candidate === null) return null
  return {
    id: record.id,
    receivedAt: record.receivedAt,
    sentAt: typeof record.sentAt === 'number' ? record.sentAt : record.receivedAt,
    source: SOURCES.has(record.source ?? '') ? (record.source as DetectionSource) : 'sms',
    auto: record.auto === true,
    // Records queued before keys were stored derive the same key from the fingerprint.
    requestId:
      typeof record.requestId === 'string' && UUID.test(record.requestId)
        ? record.requestId
        : confirmationRequestId(candidate.fingerprint),
    candidate,
  }
}

export const smsCapture = {
  isAndroid,

  async status(): Promise<SmsCaptureStatus> {
    return isAndroid() ? statusFrom(await native.getStatus()) : UNAVAILABLE_ON_WEB
  },

  /**
   * Call only after the in-app disclosure was accepted (Play's Prominent
   * Disclosure rule). Asks for SMS — and, on Android 13+, notification —
   * permission, and turns detection on if SMS access was granted.
   */
  async enable(): Promise<SmsCaptureStatus> {
    if (!isAndroid()) return UNAVAILABLE_ON_WEB
    const granted = await native.requestCapturePermissions()
    if (granted.sms === 'granted') await native.setEnabled({ enabled: true })
    return statusFrom(await native.getStatus())
  },

  async disable(): Promise<void> {
    if (isAndroid()) await native.setEnabled({ enabled: false })
  },

  async setAutoAdd(enabled: boolean): Promise<SmsCaptureStatus> {
    if (!isAndroid()) return UNAVAILABLE_ON_WEB
    await native.setAutoAdd({ enabled })
    return statusFrom(await native.getStatus())
  },

  /**
   * Payment-app notifications, after their disclosure was accepted: turns the
   * source on and opens Android's Notification access screen, where the user
   * grants it. Turning it off needs no screen.
   */
  async setPaymentApps(enabled: boolean): Promise<SmsCaptureStatus> {
    if (!isAndroid()) return UNAVAILABLE_ON_WEB
    await native.setPaymentApps({ enabled })
    const status = statusFrom(await native.getStatus())
    if (enabled && !status.notificationAccess) await native.openNotificationAccess()
    return status
  },

  async openNotificationAccess(): Promise<void> {
    if (isAndroid()) await native.openNotificationAccess()
  },

  /** READ_SMS, after the import disclosure was accepted. */
  async requestInbox(): Promise<PermissionState> {
    if (!isAndroid()) return 'denied'
    return (await native.requestInboxPermission()).inbox ?? 'denied'
  },

  /** Reads bank messages from the last `days` days into the queue. Counts only — never content. */
  async importInbox(days: number): Promise<ImportCounts> {
    if (!isAndroid()) throw new Error('Importing messages needs the Android app.')
    return native.importInbox({ days })
  },

  /** Pending detections, newest first. A record that fails validation is dropped. */
  async listPending(): Promise<Detection[]> {
    if (!isAndroid()) return []
    const { detections } = await native.listPending()
    const valid: Detection[] = []
    for (const record of detections) {
      const detection = detectionFrom(record)
      if (detection === null) void native.remove({ id: record.id })
      else valid.push(detection)
    }
    return valid.sort((a, b) => b.receivedAt - a.receivedAt)
  },

  /** Confirmed, ignored or undone: the candidate leaves the device queue, its notification goes. */
  async remove(id: string): Promise<void> {
    if (isAndroid()) await native.remove({ id })
  },

  /**
   * Added by the app: out of the queue. With a notice, its notification becomes
   * "added" with Undo; without one, it goes away.
   */
  async settle(
    id: string,
    added: { readonly requestId: string; readonly notice: DetectionNotice } | null,
  ): Promise<void> {
    if (!isAndroid()) return
    await native.settle(added === null ? { id } : { id, ...added })
  },

  /** Needs a person after all: kept for review; a live detection's notification says so. */
  async hold(id: string, notice: DetectionNotice): Promise<void> {
    if (isAndroid()) await native.hold({ id, notice })
  },

  /** The rules, categories, currency and accounts the receiver needs while the app is closed. */
  async syncContext(context: CaptureContext): Promise<void> {
    if (!isAndroid()) return
    await native.syncContext({
      rules: JSON.stringify(context.rules),
      categories: JSON.stringify(
        context.categories.map(({ slug, kind, name, isArchived }) => ({
          slug,
          kind,
          name,
          isArchived,
        })),
      ),
      currency: context.currency,
      accounts: JSON.stringify(
        context.accounts.map(({ type, last4, isArchived }) => ({ type, last4, isArchived })),
      ),
    })
  },

  /** The detection whose notification launched or resumed the app, once. */
  async takeOpenedDetection(): Promise<OpenedDetection | null> {
    if (!isAndroid()) return null
    return openedFrom(await native.takeOpenedDetection())
  },

  async openAppSettings(): Promise<void> {
    if (isAndroid()) await native.openAppSettings()
  },

  onDetectionAdded(handler: (id: string) => void): () => void {
    if (!isAndroid()) return () => {}
    const handle = native.addListener('detectionAdded', ({ id }) => {
      if (typeof id === 'string' && id !== '') handler(id)
    })
    return () => {
      void handle.then((registered) => registered.remove())
    }
  },

  onDetectionOpened(handler: (opened: OpenedDetection) => void): () => void {
    if (!isAndroid()) return () => {}
    const handle = native.addListener('detectionOpened', (data) => {
      const opened = openedFrom(data)
      if (opened !== null) handler(opened)
    })
    return () => {
      void handle.then((registered) => registered.remove())
    }
  },
}

export type SmsCapturePort = typeof smsCapture
