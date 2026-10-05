/**
 * The error model — API.md §5.
 *
 * Types only, plus the two `Result` constructors. Creating an `AppError`
 * needs a correlation id, which needs randomness, which `domain/` may not
 * have; the factories live in `lib/errors.ts`.
 */

export type ErrorKind =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'data_access'
  | 'network'
  | 'unexpected'

export interface AppError {
  readonly kind: ErrorKind
  /** Stable and machine-readable: `transaction.amount_positive`. */
  readonly code: string
  /** Safe to render. Written by us, per code. NEVER a database message. */
  readonly userMessage: string
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>
  /** Logged, and shown in the UI for support. */
  readonly correlationId: string
  /** Logged only, never rendered. */
  readonly cause?: unknown
  readonly retryable: boolean
}

export type Result<T, E = AppError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export function isAppError(value: unknown): value is AppError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['kind'] === 'string' &&
    typeof candidate['code'] === 'string' &&
    typeof candidate['userMessage'] === 'string' &&
    typeof candidate['correlationId'] === 'string'
  )
}
