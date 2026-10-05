import { useEffect, useEffectEvent } from 'react'
import { useNavigate } from 'react-router'

import { leaveApp, onSystemBack, type SystemBackEvent } from '@/platform/navigation/systemBack'

/**
 * The one handler for Android's system Back (button or gesture), mounted once
 * inside the router. A press does exactly one thing, in this order:
 *
 *   1. an open dialog or sheet closes — what Back means on Android while one is
 *      up. A route-based sheet (/transactions/new) closes by going back itself.
 *   2. otherwise the router goes back one entry — the same `navigate(-1)` as
 *      the browser's back button, so history is never duplicated;
 *   3. otherwise, at the first entry, the app goes to the background, as
 *      Android does at the root of any app.
 */
export function SystemBackHandler() {
  const navigate = useNavigate()

  const handleBack = useEffectEvent(({ canGoBack }: SystemBackEvent) => {
    if (dismissTopLayer()) return
    if (canGoBack) void navigate(-1)
    else void leaveApp()
  })

  // Subscribed once for the app's lifetime. Re-subscribing on every route change
  // (navigate's identity changes with the location) would leave a moment where
  // the old listener — removed asynchronously — and the new one both fire.
  useEffect(() => onSystemBack((event) => handleBack(event)), [])

  return null
}

const OPEN_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'

/**
 * Closes the topmost open dialog the way the keyboard does: every dialog here
 * is a Radix dialog, which closes on Escape (calling its own `onOpenChange`).
 */
function dismissTopLayer(): boolean {
  if (document.querySelector(OPEN_LAYER) === null) return false
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  )
  return true
}
