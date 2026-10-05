import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

/**
 * Where the signed-in session is kept — ARCHITECTURE.md §M.1 "Session",
 * SECURITY.md §3 "Session persistence".
 *
 * On Android the session goes to `@capacitor/preferences` (the app's private
 * SharedPreferences), not the WebView's localStorage. WebView data can be
 * cleared without the app being uninstalled — by a WebView update, a storage
 * purge, or "Clear cache" — and that would sign the user out. The refresh
 * token rotates, so a lost session cannot be recovered, only re-entered.
 *
 * On the web there is no such store: this returns `undefined` and supabase-js
 * keeps using localStorage, as it always has.
 */
export interface AuthStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export function deviceAuthStorage(): AuthStorage | undefined {
  if (Capacitor.getPlatform() !== 'android') return undefined
  return {
    async getItem(key) {
      const { value } = await Preferences.get({ key })
      if (value !== null) return value
      // Builds before this one kept the session in localStorage. Move it once,
      // so updating the app does not sign anyone out.
      const legacy = readLegacy(key)
      if (legacy === null) return null
      await Preferences.set({ key, value: legacy })
      removeLegacy(key)
      return legacy
    },
    async setItem(key, value) {
      await Preferences.set({ key, value })
    },
    async removeItem(key) {
      await Preferences.remove({ key })
      removeLegacy(key)
    },
  }
}

function readLegacy(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key)
  } catch {
    return null
  }
}

function removeLegacy(key: string): void {
  try {
    globalThis.localStorage.removeItem(key)
  } catch {
    // No localStorage: nothing was ever kept there.
  }
}
