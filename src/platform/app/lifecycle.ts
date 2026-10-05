import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/**
 * The app coming back to the foreground on Android (ARCHITECTURE.md §M.1:
 * features never import `@capacitor/*`). On the web there is no such event to
 * wait for — a tab that regains focus already has a live page.
 */
export function onAppResume(handler: () => void): () => void {
  if (Capacitor.getPlatform() !== 'android') return () => {}
  const registration = App.addListener('resume', handler)
  return () => {
    void registration.then((listener) => listener.remove())
  }
}
