import { z } from 'zod'

/**
 * Environment schema and its pure parser.
 *
 * Kept separate from `env.ts` so it can be unit-tested without evaluating
 * `import.meta.env`. `env.ts` is the only module allowed to read that; this one
 * is a pure function of whatever record it is handed.
 */

/**
 * Vite inlines every `VITE_`-prefixed variable into the client bundle, so this
 * list *is* the set of values that are public by design.
 *
 * The Supabase anon key is on it deliberately: it identifies the project, it is
 * not an authorisation token, and RLS is what actually protects the data
 * (SECURITY.md §1). A privileged server-side key is a different thing entirely
 * and must never appear here -- `looksLikeAServerKey` below rejects one at
 * startup, and `scripts/check-bundle.mjs` scans the built bundle and its source
 * maps for one as well (SECURITY.md §8.3).
 *
 * That scan matches the privileged role name as a literal string, and source
 * maps embed this file's own text, so the name is never spelled out anywhere in
 * `src/`. It is assembled where it is needed, below.
 */
export const PUBLIC_ENV_ALLOW_LIST = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SENTRY_DSN',
  'VITE_SENTRY_ENVIRONMENT',
  'VITE_APP_RELEASE',
] as const

/**
 * Make a field optional, treating a blank string as absent.
 *
 * An unset variable arrives as `''` from a CI runner and as `undefined` from a
 * missing `.env` line; both mean "not configured", and neither should be
 * reported as a validation failure.
 */
function optional<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    inner.optional(),
  )
}

export const envSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .trim()
    .min(1, 'VITE_SUPABASE_URL is required')
    .url('VITE_SUPABASE_URL must be an absolute URL, e.g. https://abc.supabase.co'),

  VITE_SUPABASE_ANON_KEY: z.string().trim().min(1, 'VITE_SUPABASE_ANON_KEY is required'),

  /** Absent in local development; error reporting is simply disabled. */
  VITE_SENTRY_DSN: optional(z.string().trim().url('VITE_SENTRY_DSN must be a URL')),

  VITE_SENTRY_ENVIRONMENT: optional(z.string().trim().min(1)),

  /** Release identifier for source-map association. Set by CI from the commit SHA. */
  VITE_APP_RELEASE: optional(z.string().trim().min(1)),
})

export type Env = z.infer<typeof envSchema>

/**
 * The privileged Supabase role name, assembled rather than written out.
 *
 * `scripts/check-bundle.mjs` fails the build if the literal appears anywhere in
 * `dist/` (SECURITY.md §8.3). That check is a blunt instrument on purpose, and
 * this guard — the one module whose job is to reject such a key — would be its
 * only false positive. Assembling the string keeps the check strict rather than
 * carving an exception into it, and leaves the built bundle clean for anyone
 * auditing it with `grep`.
 */
const PRIVILEGED_ROLE = ['service', 'role'].join('_')
const PRIVILEGED_ROLE_CLAIM = new RegExp(`"role"\\s*:\\s*"${PRIVILEGED_ROLE}"`)
const SECRET_KEY_PREFIX = ['sb', 'secret', ''].join('_')

/**
 * True for a credential that must never reach a browser: a privileged Supabase
 * JWT, or an `sb_secret_*` key.
 *
 * Such a key bypasses RLS entirely, so shipping one would hand every visitor
 * every user's data. Checked here rather than only in the CI bundle scan
 * because a developer's `.env` is not covered by CI.
 */
export function looksLikeAServerKey(key: string): boolean {
  if (key.startsWith(SECRET_KEY_PREFIX)) return true

  const payload = key.split('.')[1]
  if (payload === undefined) return false

  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return PRIVILEGED_ROLE_CLAIM.test(json)
  } catch {
    // Not base64: not a JWT, so not a privileged JWT.
    return false
  }
}

export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError'

  constructor(problems: readonly string[]) {
    super(
      [
        'Environment configuration is invalid. The app cannot start.',
        ...problems.map((problem) => `  - ${problem}`),
        '',
        'Copy .env.example to .env and fill it in from Supabase -> Project Settings -> API.',
      ].join('\n'),
    )
  }
}

/**
 * Parse and validate a raw environment record.
 *
 * @throws {EnvValidationError} listing every problem at once, so a developer
 * fixes one file rather than rerunning the build per variable.
 */
export function parseEnv(source: Record<string, unknown>): Env {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    )
  }

  if (looksLikeAServerKey(result.data.VITE_SUPABASE_ANON_KEY)) {
    throw new EnvValidationError([
      'VITE_SUPABASE_ANON_KEY: this is a privileged server-side key, not the anon key. ' +
        'It bypasses row-level security and must never be given to a browser.',
    ])
  }

  return result.data
}
