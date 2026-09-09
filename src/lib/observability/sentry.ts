import * as Sentry from '@sentry/react'

import type { Env } from '@/config/env.schema'

import { scrubEvent, type ScrubbableEvent } from './scrubEvent'

/**
 * Sentry initialisation (ARCHITECTURE.md §K).
 *
 * Two things matter here and nothing else does:
 *
 * 1. **`beforeSend` is the allow-list**, not a convenience. Every event is
 *    rebuilt from known-safe fields before it leaves the device. See
 *    `scrubEvent.ts` and its test.
 * 2. **`sendDefaultPii` is false.** The SDK would otherwise attach IP address
 *    and request headers on its own, behind our back.
 *
 * With no DSN configured — the normal state in local development — nothing is
 * initialised at all, so there is no path by which a developer's own data
 * reaches a third party.
 */
export function initObservability(env: Env, mode: string): boolean {
  const dsn = env.VITE_SENTRY_DSN
  if (dsn === undefined) return false

  Sentry.init({
    dsn,
    environment: env.VITE_SENTRY_ENVIRONMENT ?? mode,
    ...(env.VITE_APP_RELEASE === undefined ? {} : { release: env.VITE_APP_RELEASE }),

    // The SDK must never enrich an event with data we did not choose to send.
    sendDefaultPii: false,

    // Performance is sampled, errors are not. Raised deliberately in M10 once
    // there are real budgets to measure against (ARCHITECTURE.md §L).
    tracesSampleRate: 0.1,

    // No `replayIntegration`: a session replay of this product is a video of
    // someone's finances.
    integrations: [Sentry.browserTracingIntegration()],

    beforeSend: (event) =>
      scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,

    beforeBreadcrumb: (breadcrumb) => {
      // Console output is the v1 leak vector; never turn it into a breadcrumb.
      if (breadcrumb.category === 'console') return null
      return breadcrumb
    },
  })

  return true
}
