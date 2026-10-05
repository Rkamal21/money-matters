import * as Sentry from '@sentry/react'

import { scrubEvent, type ScrubbableEvent } from './scrubEvent'
import { connectSinks } from './sink'

/**
 * The Sentry SDK itself, in its own lazily loaded chunk (see `sentry.ts`).
 *
 * Two things matter here and nothing else does:
 *
 * 1. **`beforeSend` is the allow-list**, not a convenience. Every event is
 *    rebuilt from known-safe fields before it leaves the device. See
 *    `scrubEvent.ts` and its test.
 * 2. **`sendDefaultPii` is false.** The SDK would otherwise attach IP address
 *    and request headers on its own, behind our back.
 */
export function startSentry(options: {
  readonly dsn: string
  readonly environment: string
  readonly release: string | undefined
}): void {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    ...(options.release === undefined ? {} : { release: options.release }),

    // The SDK must never enrich an event with data we did not choose to send.
    sendDefaultPii: false,

    // Performance is sampled, errors are not (ARCHITECTURE.md §L).
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

  connectSinks({
    breadcrumb: (crumb) =>
      Sentry.addBreadcrumb({
        category: crumb.category,
        level: crumb.level,
        message: crumb.message,
        ...(crumb.data === undefined ? {} : { data: crumb.data }),
      }),
    exception: (error, context) =>
      Sentry.captureException(error, {
        tags: { kind: context.kind, code: context.code },
        extra: { correlationId: context.correlationId },
      }),
  })
}
