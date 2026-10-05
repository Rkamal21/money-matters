import { beforeEach, describe, expect, it, vi } from 'vitest'

const platform = { name: 'android' }
const prefs = new Map<string, string>()

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: ({ key }: { key: string }) => Promise.resolve({ value: prefs.get(key) ?? null }),
    set: ({ key, value }: { key: string; value: string }) => {
      prefs.set(key, value)
      return Promise.resolve()
    },
    remove: ({ key }: { key: string }) => {
      prefs.delete(key)
      return Promise.resolve()
    },
  },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => platform.name } }))

const { deviceStore } = await import('./deviceStore')

beforeEach(() => {
  platform.name = 'android'
  prefs.clear()
})

describe('deviceStore', () => {
  it('has no store on the web: financial data stays out of browser storage (SECURITY.md T20)', () => {
    platform.name = 'web'
    expect(deviceStore()).toBeNull()
  })

  it('reads, writes and removes app preferences on Android', async () => {
    const store = deviceStore()
    expect(await store?.get('k')).toBeNull()
    await store?.set('k', 'v')
    expect(await store?.get('k')).toBe('v')
    await store?.remove('k')
    expect(await store?.get('k')).toBeNull()
  })
})
