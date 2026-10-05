/**
 * The seam between the app and the error-tracking SDK.
 *
 * The Sentry SDK is loaded on demand, and only when a DSN is configured
 * (`sentry.ts`), so nothing in the app may import it directly. Code reports
 * through these two functions; the runtime plugs itself in when — if — it
 * arrives. Until then breadcrumbs wait in a short buffer and exceptions are
 * dropped, which is exactly what should happen in a build with no DSN.
 */

export interface Breadcrumb {
  readonly category: string
  readonly level: 'info' | 'warning' | 'error'
  readonly message: string
  readonly data?: Record<string, unknown>
}

export interface ExceptionContext {
  readonly kind: string
  readonly code: string
  readonly correlationId: string
}

type BreadcrumbSink = (crumb: Breadcrumb) => void
type ExceptionSink = (error: unknown, context: ExceptionContext) => void

const MAX_PENDING = 50

let breadcrumbSink: BreadcrumbSink | null = null
let exceptionSink: ExceptionSink | null = null
const pending: Breadcrumb[] = []

export function connectSinks(sinks: {
  readonly breadcrumb: BreadcrumbSink
  readonly exception: ExceptionSink
}): void {
  breadcrumbSink = sinks.breadcrumb
  exceptionSink = sinks.exception
  for (const crumb of pending.splice(0)) sinks.breadcrumb(crumb)
}

export function addBreadcrumb(crumb: Breadcrumb): void {
  if (breadcrumbSink !== null) {
    breadcrumbSink(crumb)
    return
  }
  pending.push(crumb)
  if (pending.length > MAX_PENDING) pending.shift()
}

/** Report an exception the UI caught. The event is scrubbed by `beforeSend` like every other. */
export function captureException(error: unknown, context: ExceptionContext): void {
  exceptionSink?.(error, context)
}
