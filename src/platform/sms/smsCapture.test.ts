import { beforeEach, describe, expect, it, vi } from 'vitest'

import { confirmationRequestId } from '@/domain/transactions/ingest/review'
import { candidateOf, MESSAGES } from '@tests/fixtures/detection'

import { candidateToJSON } from './candidateJson'

/**
 * The port's contract with the native plugin, with Capacitor mocked: what the
 * app does with what Android returns — including what Android leaves out.
 */

const platform = { name: 'android' }
const native = {
  getStatus: vi.fn(),
  requestCapturePermissions: vi.fn(),
  requestInboxPermission: vi.fn(),
  setEnabled: vi.fn(() => Promise.resolve()),
  setAutoAdd: vi.fn(() => Promise.resolve()),
  setPaymentApps: vi.fn(() => Promise.resolve()),
  openNotificationAccess: vi.fn(() => Promise.resolve()),
  syncContext: vi.fn(() => Promise.resolve()),
  listPending: vi.fn(),
  remove: vi.fn(() => Promise.resolve()),
  settle: vi.fn(() => Promise.resolve()),
  hold: vi.fn(() => Promise.resolve()),
  importInbox: vi.fn(),
  takeOpenedDetection: vi.fn(),
  openAppSettings: vi.fn(() => Promise.resolve()),
  addListener: vi.fn(),
}

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform.name },
  registerPlugin: () => native,
}))

const { smsCapture } = await import('./smsCapture')

const granted = { sms: 'granted', notifications: 'granted' } as const

beforeEach(() => {
  platform.name = 'android'
  vi.clearAllMocks()
})

describe('smsCapture on the web', () => {
  it('reports itself unavailable and never touches the native plugin', async () => {
    platform.name = 'web'
    expect(await smsCapture.status()).toMatchObject({
      available: false,
      unavailable: 'not_android',
    })
    expect(await smsCapture.listPending()).toEqual([])
    expect(await smsCapture.takeOpenedDetection()).toBeNull()
    await smsCapture.syncContext({ rules: [], categories: [], currency: 'INR', accounts: [] })
    await smsCapture.remove('x')
    await smsCapture.settle('x', null)
    expect(await smsCapture.requestInbox()).toBe('denied')
    await expect(smsCapture.importInbox(90)).rejects.toThrow()
    expect(Object.values(native).some((fn) => fn.mock.calls.length > 0)).toBe(false)
  })
})

describe('smsCapture on Android', () => {
  it('is enabled only when the user opted in and SMS access is granted', async () => {
    native.getStatus.mockResolvedValue({ ...granted, supported: true, enabled: true })
    expect(await smsCapture.status()).toMatchObject({ available: true, enabled: true })

    native.getStatus.mockResolvedValue({
      ...granted,
      sms: 'denied',
      supported: true,
      enabled: true,
    })
    expect((await smsCapture.status()).enabled).toBe(false)

    native.getStatus.mockResolvedValue({ ...granted, supported: false, enabled: true })
    expect(await smsCapture.status()).toMatchObject({
      available: false,
      unavailable: 'unsupported_device',
      enabled: false,
    })
  })

  it('turns detection on only after SMS access is granted', async () => {
    native.requestCapturePermissions.mockResolvedValue({ sms: 'denied', notifications: 'granted' })
    native.getStatus.mockResolvedValue({
      sms: 'denied',
      notifications: 'granted',
      supported: true,
      enabled: false,
    })
    await smsCapture.enable()
    expect(native.setEnabled).not.toHaveBeenCalled()

    native.requestCapturePermissions.mockResolvedValue(granted)
    native.getStatus.mockResolvedValue({ ...granted, supported: true, enabled: true })
    expect((await smsCapture.enable()).enabled).toBe(true)
    expect(native.setEnabled).toHaveBeenCalledWith({ enabled: true })
  })

  it('adds automatically unless the user turned it off', async () => {
    native.getStatus.mockResolvedValue({ ...granted, supported: true, enabled: true })
    expect((await smsCapture.status()).autoAdd).toBe(true)
    native.getStatus.mockResolvedValue({
      ...granted,
      supported: true,
      enabled: true,
      autoAdd: false,
    })
    expect((await smsCapture.setAutoAdd(false)).autoAdd).toBe(false)
    expect(native.setAutoAdd).toHaveBeenCalledWith({ enabled: false })
  })

  it('turns payment apps on and sends the user to Notification access only when it is not granted', async () => {
    native.getStatus.mockResolvedValue({
      ...granted,
      supported: true,
      enabled: true,
      paymentApps: true,
    })
    expect((await smsCapture.setPaymentApps(true)).paymentApps).toBe(true)
    expect(native.setPaymentApps).toHaveBeenCalledWith({ enabled: true })
    expect(native.openNotificationAccess).toHaveBeenCalledTimes(1)

    native.getStatus.mockResolvedValue({
      ...granted,
      supported: true,
      enabled: true,
      paymentApps: true,
      notificationAccess: true,
    })
    await smsCapture.setPaymentApps(true)
    expect(native.openNotificationAccess).toHaveBeenCalledTimes(1)
  })

  it('treats a missing or null opened id as "nothing opened" — never "/detected/undefined"', async () => {
    native.takeOpenedDetection.mockResolvedValue({})
    expect(await smsCapture.takeOpenedDetection()).toBeNull()
    native.takeOpenedDetection.mockResolvedValue({ id: null })
    expect(await smsCapture.takeOpenedDetection()).toBeNull()
    native.takeOpenedDetection.mockResolvedValue({ id: 'abc' })
    expect(await smsCapture.takeOpenedDetection()).toEqual({
      id: 'abc',
      requestId: null,
      action: 'open',
    })
  })

  it('tells Undo from a plain tap, and keeps only a well-formed key', async () => {
    const key = '0b1c2d3e-4f50-8617-a819-2a3b4c5d6e7f'
    native.takeOpenedDetection.mockResolvedValue({ id: 'abc', requestId: key, action: 'undo' })
    expect(await smsCapture.takeOpenedDetection()).toEqual({
      id: 'abc',
      requestId: key,
      action: 'undo',
    })
    native.takeOpenedDetection.mockResolvedValue({
      id: 'abc',
      requestId: 'not-a-key',
      action: 'boom',
    })
    expect(await smsCapture.takeOpenedDetection()).toEqual({
      id: 'abc',
      requestId: null,
      action: 'open',
    })
  })

  it('ignores a listener event without an id', () => {
    let fire: (data: { id?: string | null; action?: string }) => void = () => {}
    native.addListener.mockImplementation((_event: string, listener: typeof fire) => {
      fire = listener
      return Promise.resolve({ remove: () => Promise.resolve() })
    })
    const handler = vi.fn()
    const stop = smsCapture.onDetectionOpened(handler)
    fire({})
    fire({ id: 'abc', action: 'undo' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ id: 'abc', requestId: null, action: 'undo' })
    stop()
  })

  it('lists valid detections newest first and drops a corrupted record from the queue', async () => {
    const candidate = JSON.stringify(candidateToJSON(candidateOf(MESSAGES.expense)))
    native.listPending.mockResolvedValue({
      detections: [
        { id: 'old', receivedAt: 1, candidate },
        { id: 'broken', receivedAt: 2, candidate: '{"amount":"nope"}' },
        { id: 'not-json', receivedAt: 3, candidate: '{' },
        { id: 'new', receivedAt: 4, candidate },
      ],
    })
    const pending = await smsCapture.listPending()
    expect(pending.map((detection) => detection.id)).toEqual(['new', 'old'])
    expect(pending[0]?.candidate.amount.minor).toBe(48600n)
    // Queued by the earlier build: no source, key or send time stored.
    expect(pending[0]).toMatchObject({
      source: 'sms',
      auto: false,
      sentAt: 4,
      requestId: confirmationRequestId(candidateOf(MESSAGES.expense).fingerprint),
    })
    expect(native.remove).toHaveBeenCalledWith({ id: 'broken' })
    expect(native.remove).toHaveBeenCalledWith({ id: 'not-json' })
  })

  it('keeps what Android stores about a detection', async () => {
    const candidate = JSON.stringify(candidateToJSON(candidateOf(MESSAGES.expense)))
    const key = '0b1c2d3e-4f50-8617-a819-2a3b4c5d6e7f'
    native.listPending.mockResolvedValue({
      detections: [
        {
          id: 'd',
          receivedAt: 9,
          sentAt: 7,
          source: 'import',
          auto: true,
          requestId: key,
          candidate,
        },
      ],
    })
    expect((await smsCapture.listPending())[0]).toMatchObject({
      source: 'import',
      auto: true,
      sentAt: 7,
      requestId: key,
    })
  })

  it('settles an added detection with its "added" notice, or silently', async () => {
    const notice = { title: 'Transaction added', text: 't', publicText: 'p' }
    await smsCapture.settle('d1', { requestId: 'r1', notice })
    expect(native.settle).toHaveBeenCalledWith({ id: 'd1', requestId: 'r1', notice })
    await smsCapture.settle('d2', null)
    expect(native.settle).toHaveBeenCalledWith({ id: 'd2' })
  })

  it('holds a detection for review with its review notice', async () => {
    const notice = { title: 'Transaction detected', text: 't', publicText: 'p' }
    await smsCapture.hold('d1', notice)
    expect(native.hold).toHaveBeenCalledWith({ id: 'd1', notice })
  })

  it('imports through the native plugin and returns its counts', async () => {
    const counts = { messages: 40, fromBanks: 12, queued: 9, alreadyFound: 1, notTransactions: 2 }
    native.importInbox.mockResolvedValue(counts)
    expect(await smsCapture.importInbox(90)).toEqual(counts)
    expect(native.importInbox).toHaveBeenCalledWith({ days: 90 })
    native.requestInboxPermission.mockResolvedValue({ ...granted, inbox: 'granted' })
    expect(await smsCapture.requestInbox()).toBe('granted')
  })

  it('passes the receiver rules, category labels and account digits — no ids, names or balances', async () => {
    await smsCapture.syncContext({
      rules: [],
      categories: [
        { slug: 'food', kind: 'expense', name: 'Food', isArchived: false, id: 'x' } as never,
      ],
      currency: 'INR',
      accounts: [
        {
          type: 'bank',
          last4: '1234',
          isArchived: false,
          id: 'secret',
          name: 'SBI',
          balance: 1,
        } as never,
      ],
    })
    expect(native.syncContext).toHaveBeenCalledWith({
      rules: '[]',
      categories: '[{"slug":"food","kind":"expense","name":"Food","isArchived":false}]',
      currency: 'INR',
      accounts: '[{"type":"bank","last4":"1234","isArchived":false}]',
    })
  })
})
