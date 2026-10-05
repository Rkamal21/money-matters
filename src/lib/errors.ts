import { type AppError, type ErrorKind, isAppError } from '@/domain/errors/AppError'

/**
 * AppError factories — API.md §5.
 *
 * Every error gets a correlation id at the point of failure, so a user's
 * "reference c-8f3a12" maps to one Sentry event without anyone asking them
 * what they were doing (ARCHITECTURE.md §K).
 */

export function correlationId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return `c-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function createAppError(input: {
  readonly kind: ErrorKind
  readonly code: string
  readonly userMessage: string
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>
  readonly cause?: unknown
  readonly retryable?: boolean
}): AppError {
  return {
    kind: input.kind,
    code: input.code,
    userMessage: input.userMessage,
    ...(input.fieldErrors === undefined ? {} : { fieldErrors: input.fieldErrors }),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
    correlationId: correlationId(),
    retryable: input.retryable ?? (input.kind === 'network' || input.kind === 'rate_limited'),
  }
}

/**
 * What a repository throws. Repositories throw because a data-layer failure is
 * exceptional; services return `Result` because a validation failure is an
 * outcome the UI must render (API.md §1).
 */
export class AppErrorException extends Error {
  override readonly name = 'AppErrorException'
  readonly appError: AppError

  constructor(appError: AppError) {
    // The message is our own user-facing text, never a database message.
    super(appError.userMessage)
    this.appError = appError
  }
}

export function unexpectedError(cause?: unknown): AppError {
  return createAppError({
    kind: 'unexpected',
    code: 'app.unexpected',
    userMessage: 'Something went wrong on our side. Please try again.',
    cause,
  })
}

/** Any thrown value, as an AppError. Never inspects or renders the raw message. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppErrorException) return error.appError
  if (isAppError(error)) return error
  return unexpectedError(error)
}

export function validationError(
  code: string,
  userMessage: string,
  fieldErrors?: Readonly<Record<string, readonly string[]>>,
): AppError {
  return createAppError({
    kind: 'validation',
    code,
    userMessage,
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
  })
}
