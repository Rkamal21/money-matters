import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { useMediaQuery } from '@/hooks/useMediaQuery'
import { readStoredTheme, storeTheme, ThemeContext, type ThemePreference } from '@/lib/theme'

/**
 * Applies the theme by setting `data-theme` on <html>; the palettes in
 * theme.css do the rest. "System" removes the attribute and lets the
 * `prefers-color-scheme` block decide. `public/theme-boot.js` applies the
 * stored choice before first paint, so there is no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredTheme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    const root = document.documentElement
    if (preference === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', preference)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0b0d10' : '#f6f7f9')
  }, [preference, resolved])

  const setPreference = useCallback((next: ThemePreference) => {
    storeTheme(next)
    setPreferenceState(next)
  }, [])

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
