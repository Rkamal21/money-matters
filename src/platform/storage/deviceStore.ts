import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

/**
 * App-private storage for the signed-in user's data, where the device has it.
 *
 * On Android this is the app's own SharedPreferences (`@capacitor/preferences`),
 * inside the app sandbox, like the session (ARCHITECTURE.md §M.1). On the web
 * it is `null`: SECURITY.md T20 keeps financial data out of browser storage, so
 * a caller keeps what it needs in memory instead.
 */
export interface DeviceStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export function deviceStore(): DeviceStore | null {
  if (Capacitor.getPlatform() !== 'android') return null
  return {
    async get(key) {
      return (await Preferences.get({ key })).value
    },
    async set(key, value) {
      await Preferences.set({ key, value })
    },
    async remove(key) {
      await Preferences.remove({ key })
    },
  }
}
