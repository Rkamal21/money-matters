/**
 * Sentry payload scrubbing.
 *
 * ARCHITECTURE.md §K: "Scrubbing is code, not policy." The hook runs an
 * **allow-list** over event data — unknown keys are dropped rather than
 * known-bad keys removed, because a deny-list fails silently the first time
 * someone adds a field.
 *
 * What error tracking may carry: `AppError.kind`, `code`, `correlationId`,
 * route, release, stack.
 * What it may never carry: amounts, merchants, descriptions, emails, tokens,
 * SMS content.
 *
 * The v1 anti-pattern this exists to prevent is a complete bank SMS — balances
 * and account fragments included — sitting in Logcat.
 */

/** Keys whose values may survive inside any structured payload. */
const ALLOWED_DATA_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'code',
  'correlationId',
  'correlation_id',
  'route',
  'release',
  'environment',
  'status',
  'outcome',
  'durationMs',
  'retryable',
])

/** Per-section allow-lists for `contexts`. Everything not named here is dropped. */
const ALLOWED_CONTEXT_KEYS: Readonly<Record<string, readonly string[]>> = {
  trace: ['trace_id', 'span_id', 'parent_span_id', 'op', 'status'],
  browser: ['name', 'version'],
  os: ['name', 'version'],
  runtime: ['name', 'version'],
}

const ALLOWED_BREADCRUMB_KEYS = ['type', 'category', 'level', 'timestamp'] as const

const EMAIL = /[^\s@<>()[\]:;,"]+@[^\s@<>()[\]:;,"]+\.[a-z]{2,}/gi
/** A JWT, or any `sb_*` Supabase key. Covers access tokens, refresh tokens, API keys. */
const TOKEN =
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?|\bsb_[a-z]+_[A-Za-z0-9_-]{8,}/g
const BEARER = /\b(?:bearer|token|apikey|api_key)[\s:=]+\S+/gi
/** Currency-shaped text and any long digit run: amounts and account fragments both. */
const AMOUNT = /(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?/gi
const LONG_NUMBER = /\d{4,}/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/**
 * Strip the things that are never acceptable anywhere: credentials, addresses,
 * and currency-shaped values. Applied even to values under an allow-listed key,
 * because an allowed key holding an unexpected value is a bug we would rather
 * not ship to a third party.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(TOKEN, '[redacted-token]')
    .replace(BEARER, '[redacted-token]')
    .replace(EMAIL, '[redacted-email]')
    .replace(AMOUNT, '[redacted-amount]')
}

/**
 * Redact free text we cannot structurally verify — an exception message, a
 * transaction name. Stricter than `redactSecrets`: it also removes bare
 * identifiers and long digit runs, since an account fragment in a message looks
 * like nothing in particular.
 *
 * Not used on allow-listed structured values: a Postgres error code like
 * `23505` is exactly the sort of five-digit number we want to keep.
 */
export function redactText(text: string): string {
  return redactSecrets(text)
    .replace(UUID, '[redacted-id]')
    .replace(LONG_NUMBER, '[redacted-number]')
}

/** Keep the path shape of a URL; drop the query string, the hash and any ids in it. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://localhost')
    const path = parsed.pathname.replace(UUID, ':id').replace(/\/\d+(?=\/|$)/g, '/:id')
    return parsed.origin === 'http://localhost' ? path : `${parsed.origin}${path}`
  } catch {
    return '[redacted-url]'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively keep only `ALLOWED_DATA_KEYS`. Strings that survive are still run
 * through `redactSecrets`, so an allowed key holding an unexpected token or
 * email is caught; the stricter numeric redaction is not applied here, because
 * `code: '23505'` is a legitimate value under an allowed key.
 */
export function scrubData(value: unknown, depth = 0): unknown {
  if (depth > 6) return undefined
  if (typeof value === 'string') return redactSecrets(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return value.map((item) => scrubData(item, depth + 1)).filter((item) => item !== undefined)
  }
  if (!isPlainObject(value)) return undefined

  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (!ALLOWED_DATA_KEYS.has(key)) continue
    const scrubbed = scrubData(nested, depth + 1)
    if (scrubbed !== undefined) out[key] = scrubbed
  }
  return out
}

function pick(source: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!isPlainObject(source)) return undefined
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') out[key] = redactSecrets(value)
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Structural shape of the parts of a Sentry event we act on. */
export interface ScrubbableEvent {
  readonly [key: string]: unknown
}

function scrubException(exception: unknown): unknown {
  const values = isPlainObject(exception) ? exception['values'] : undefined
  if (!Array.isArray(values)) return undefined

  return {
    values: values.map((entry) => {
      if (!isPlainObject(entry)) return {}
      const out: Record<string, unknown> = {}
      if (typeof entry['type'] === 'string') out['type'] = redactText(entry['type'])
      // The message is free text; the stack trace is the part with diagnostic value.
      if (typeof entry['value'] === 'string') out['value'] = redactText(entry['value'])
      if (entry['stacktrace'] !== undefined) out['stacktrace'] = entry['stacktrace']
      if (entry['mechanism'] !== undefined) out['mechanism'] = entry['mechanism']
      return out
    }),
  }
}

function scrubBreadcrumbs(breadcrumbs: unknown): unknown {
  if (!Array.isArray(breadcrumbs)) return undefined

  // `message` is deliberately absent: console and fetch breadcrumbs put
  // arbitrary logged content in it. Structured `data` survives the allow-list.
  return breadcrumbs.map((crumb) => {
    const kept = pick(crumb, ALLOWED_BREADCRUMB_KEYS) ?? {}
    if (isPlainObject(crumb) && crumb['data'] !== undefined) {
      const data = scrubData(crumb['data'])
      if (isPlainObject(data) && Object.keys(data).length > 0) kept['data'] = data
    }
    return kept
  })
}

function scrubContexts(contexts: unknown): unknown {
  if (!isPlainObject(contexts)) return undefined

  const out: Record<string, unknown> = {}
  for (const [section, allowed] of Object.entries(ALLOWED_CONTEXT_KEYS)) {
    const kept = pick(contexts[section], allowed)
    if (kept) out[section] = kept
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function scrubRequest(request: unknown): unknown {
  if (!isPlainObject(request)) return undefined

  // Headers, cookies, query string and body are dropped wholesale: a request
  // payload is exactly where an amount or an access token would be.
  const out: Record<string, unknown> = {}
  if (typeof request['url'] === 'string') out['url'] = redactUrl(request['url'])
  if (typeof request['method'] === 'string') out['method'] = request['method']
  return Object.keys(out).length > 0 ? out : undefined
}

function scrubUser(user: unknown): unknown {
  // The id correlates a report to an event. Email, username and IP do not, and
  // are PII (ARCHITECTURE.md §K).
  if (!isPlainObject(user) || typeof user['id'] !== 'string') return undefined
  return { id: user['id'] }
}

const PASS_THROUGH_KEYS = [
  'event_id',
  'timestamp',
  'platform',
  'level',
  'environment',
  'release',
  'dist',
] as const

/**
 * Rebuild an event from an allow-list. Anything not explicitly copied here is
 * gone — including keys added by a future Sentry SDK version.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const out: Record<string, unknown> = {}

  for (const key of PASS_THROUGH_KEYS) {
    const value = event[key]
    if (typeof value === 'string' || typeof value === 'number') out[key] = value
  }

  const sdk = pick(event['sdk'], ['name', 'version'])
  if (sdk) out['sdk'] = sdk

  if (typeof event['transaction'] === 'string') out['transaction'] = redactUrl(event['transaction'])

  const exception = scrubException(event['exception'])
  if (exception) out['exception'] = exception

  const breadcrumbs = scrubBreadcrumbs(event['breadcrumbs'])
  if (breadcrumbs) out['breadcrumbs'] = breadcrumbs

  const tags = scrubData(event['tags'])
  if (isPlainObject(tags) && Object.keys(tags).length > 0) out['tags'] = tags

  const extra = scrubData(event['extra'])
  if (isPlainObject(extra) && Object.keys(extra).length > 0) out['extra'] = extra

  const contexts = scrubContexts(event['contexts'])
  if (contexts) out['contexts'] = contexts

  const request = scrubRequest(event['request'])
  if (request) out['request'] = request

  const user = scrubUser(event['user'])
  if (user) out['user'] = user

  return out as T
}
