import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const platform = { name: 'android' }
const prefs = new Map<string, string>()
const Preferences = {
  get: vi.fn(({ key }: { key: string }) => Promise.resolve({ value: prefs.get(key) ?? null })),
  set: vi.fn(({ key, value }: { key: string; value: string }) => {
    prefs.set(key, value)
    return Promise.resolve()
  }),
  remove: vi.fn(({ key }: { key: string }) => {
    prefs.delete(key)
    return Promise.resolve()
  }),
}

vi.mock('@capacitor/preferences', () => ({ Preferences }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => platform.name } }))

const { deviceAuthStorage } = await import('./authStorage')

const KEY = 'sb-127-auth-token'
const legacy = new Map<string, string>()

beforeEach(() => {
  platform.name = 'android'
  prefs.clear()
  legacy.clear()
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => legacy.get(key) ?? null,
    removeItem: (key: string) => legacy.delete(key),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deviceAuthStorage', () => {
  it('leaves the web on localStorage: there is no device store to use', () => {
    platform.name = 'web'
    expect(deviceAuthStorage()).toBeUndefined()
  })

  it('keeps the session in Preferences on Android', async () => {
    const storage = deviceAuthStorage()
    await storage?.setItem(KEY, '{"access_token":"a"}')
    expect(prefs.get(KEY)).toBe('{"access_token":"a"}')
    expect(await storage?.getItem(KEY)).toBe('{"access_token":"a"}')
  })

  it('moves a session saved in localStorage by an older build, once', async () => {
    legacy.set(KEY, '{"access_token":"old"}')
    const storage = deviceAuthStorage()

    expect(await storage?.getItem(KEY)).toBe('{"access_token":"old"}')
    expect(prefs.get(KEY)).toBe('{"access_token":"old"}')
    expect(legacy.has(KEY)).toBe(false)

    await storage?.getItem(KEY)
    expect(Preferences.set).toHaveBeenCalledTimes(1)
  })

  it('prefers the Preferences copy over a stale localStorage one', async () => {
    prefs.set(KEY, 'current')
    legacy.set(KEY, 'stale')
    expect(await deviceAuthStorage()?.getItem(KEY)).toBe('current')
  })

  it('reports no session when neither store has one', async () => {
    expect(await deviceAuthStorage()?.getItem(KEY)).toBeNull()
  })

  it('signing out removes the session from both stores', async () => {
    prefs.set(KEY, 'current')
    legacy.set(KEY, 'stale')
    await deviceAuthStorage()?.removeItem(KEY)
    expect(prefs.has(KEY)).toBe(false)
    expect(legacy.has(KEY)).toBe(false)
  })

  it('still works where localStorage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })
    const storage = deviceAuthStorage()
    expect(await storage?.getItem(KEY)).toBeNull()
    await expect(storage?.removeItem(KEY)).resolves.toBeUndefined()
  })
})
