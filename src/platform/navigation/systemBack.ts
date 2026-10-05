import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/**
 * Android's system Back — the back button and the back gesture, which Android
 * delivers as the same event (ARCHITECTURE.md §M.1: features never import
 * `@capacitor/*`).
 *
 * While a listener is registered, `@capacitor/app` stops Android from closing
 * the activity on Back and hands the press to the app instead, with whether the
 * WebView has history to go back to. src/app/SystemBackHandler.tsx is the one
 * listener. On the web there is no system Back to handle; the browser's own
 * back button already drives the router.
 */

export interface SystemBackEvent {
  /** The WebView has a previous history entry — the router has a previous route. */
  readonly canGoBack: boolean
}

export function onSystemBack(handler: (event: SystemBackEvent) => void): () => void {
  if (Capacitor.getPlatform() !== 'android') return () => {}
  const registration = App.addListener('backButton', ({ canGoBack }) => handler({ canGoBack }))
  return () => {
    void registration.then((listener) => listener.remove())
  }
}

/**
 * What Android itself does on Back at the root: send the app to the background
 * (Android 12+ keeps a root activity alive rather than finishing it).
 */
export function leaveApp(): Promise<void> {
  return App.minimizeApp()
}
