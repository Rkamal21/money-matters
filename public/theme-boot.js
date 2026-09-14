/* global window, document */
// Applies the stored theme before first paint, so a dark-theme user never sees
// a flash of the light palette. A plain external file rather than an inline
// script, so a strict Content-Security-Policy (SECURITY.md T8) needs no
// 'unsafe-inline'. Mirrors src/lib/theme.tsx.
;(function () {
  try {
    var preference = window.localStorage.getItem('mm.theme')
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.setAttribute('data-theme', preference)
    }
  } catch {
    // Storage unavailable: follow the system preference.
  }
})()
