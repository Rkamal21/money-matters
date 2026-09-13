import { createContext, useContext } from 'react'

/**
 * Theme preference. Dark-first like v1's palette, with light and "follow the
 * system" alongside it (PRODUCT.md §5). Stored per device — it is a display
 * preference, not financial data.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

export interface ThemeState {
  readonly preference: ThemePreference
  readonly resolved: 'light' | 'dark'
  readonly setPreference: (preference: ThemePreference) => void
}

export const ThemeContext = createContext<ThemeState>({
  preference: 'system',
  resolved: 'light',
  setPreference: () => undefined,
})

export function useTheme(): ThemeState {
  return useContext(ThemeContext)
}

export const THEME_STORAGE_KEY = 'mm.theme'

export function readStoredTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function storeTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Private mode or storage disabled: the preference lasts for the session.
  }
}
