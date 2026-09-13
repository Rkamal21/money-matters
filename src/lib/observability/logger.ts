import { IS_DEV } from '@/config/env'

import { scrubData } from './scrubEvent'
import { addBreadcrumb } from './sink'

/**
 * Structured logging (ARCHITECTURE.md §K).
 *
 * Carries: event name, route, duration, outcome.
 * Never carries: any financial value or PII.
 *
 * `console.log` is lint-banned across `src/` (SECURITY.md §8.3) precisely so
 * that this is the only path. The payload goes through the same allow-list the
 * Sentry hook uses, so a field nobody thought about is dropped here too.
 */

export type LogLevel = 'info' | 'warn' | 'error'

export type LogFields = Readonly<Record<string, unknown>>

/** Sentry spells the middle level "warning"; the console spells it "warn". */
const SENTRY_LEVEL = { info: 'info', warn: 'warning', error: 'error' } as const

function emit(level: LogLevel, event: string, fields: LogFields): void {
  const data = scrubData(fields)

  addBreadcrumb({
    category: 'app',
    level: SENTRY_LEVEL[level],
    message: event,
    ...(data === undefined ? {} : { data: data as Record<string, unknown> }),
  })

  if (IS_DEV) {
    // eslint-disable-next-line no-console -- the dev channel described in §K.
    console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info'](`[${event}]`, data)
  }
}

export const logger = {
  info: (event: string, fields: LogFields = {}) => emit('info', event, fields),
  warn: (event: string, fields: LogFields = {}) => emit('warn', event, fields),
  error: (event: string, fields: LogFields = {}) => emit('error', event, fields),
}
