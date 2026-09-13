import type { Env } from '@/config/env.schema'

/**
 * Error tracking, initialised (ARCHITECTURE.md §K).
 *
 * With no DSN configured — the normal state in local development — nothing is
 * initialised and nothing is downloaded, so there is no path by which a
 * developer's own data reaches a third party.
 *
 * With a DSN, the SDK arrives as its own chunk after first render. It is a
 * quarter of a megabyte of JavaScript, and the initial bundle budget of
 * ARCHITECTURE.md §L is for the product, not for the error reporter. Anything
 * logged before it lands waits in `sink.ts`'s buffer.
 *
 * The scrubbing `beforeSend` and every other option live in `sentryRuntime.ts`.
 */
export function initObservability(env: Env, mode: string): boolean {
  const dsn = env.VITE_SENTRY_DSN
  if (dsn === undefined) return false

  void import('./sentryRuntime').then((runtime) =>
    runtime.startSentry({
      dsn,
      environment: env.VITE_SENTRY_ENVIRONMENT ?? mode,
      release: env.VITE_APP_RELEASE,
    }),
  )
  return true
}
