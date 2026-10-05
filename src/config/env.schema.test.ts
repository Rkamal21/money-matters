import { describe, expect, it } from 'vitest'

import { EnvValidationError, looksLikeAServerKey, parseEnv } from './env.schema'

/** A syntactically valid JWT carrying the given payload. Signature is irrelevant here. */
function jwtWithPayload(payload: Record<string, unknown>): string {
  const b64 = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64('{"alg":"HS256","typ":"JWT"}')}.${b64(JSON.stringify(payload))}.signature`
}

const anonKey = jwtWithPayload({ iss: 'supabase', role: 'anon' })

const validEnv = {
  VITE_SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  VITE_SUPABASE_ANON_KEY: anonKey,
}

describe('parseEnv', () => {
  it('accepts the minimum viable configuration', () => {
    const env = parseEnv({ ...validEnv })

    expect(env.VITE_SUPABASE_URL).toBe('https://abcdefghijkl.supabase.co')
    expect(env.VITE_SENTRY_DSN).toBeUndefined()
  })

  it('reports every problem at once rather than the first', () => {
    let message = ''
    try {
      parseEnv({ VITE_SUPABASE_URL: 'not-a-url' })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('VITE_SUPABASE_URL')
    expect(message).toContain('VITE_SUPABASE_ANON_KEY')
  })

  it('treats an empty string as absent, because an unset CI variable arrives as one', () => {
    const env = parseEnv({ ...validEnv, VITE_SENTRY_DSN: '   ' })

    expect(env.VITE_SENTRY_DSN).toBeUndefined()
  })

  it('rejects a malformed Sentry DSN rather than silently disabling reporting', () => {
    expect(() => parseEnv({ ...validEnv, VITE_SENTRY_DSN: 'nope' })).toThrow(EnvValidationError)
  })

  // SECURITY.md 8.3: a service_role key in the client bundle hands every
  // visitor every user's data, because it bypasses RLS.
  it('refuses to start when the anon key is really a service_role key', () => {
    const serviceKey = jwtWithPayload({ iss: 'supabase', role: 'service_role' })

    expect(() => parseEnv({ ...validEnv, VITE_SUPABASE_ANON_KEY: serviceKey })).toThrow(
      /privileged server-side key/,
    )
  })

  it('refuses a sb_secret_ key too', () => {
    expect(() =>
      parseEnv({ ...validEnv, VITE_SUPABASE_ANON_KEY: 'sb_secret_abcdefghijklmnop' }),
    ).toThrow(/privileged server-side key/)
  })
})

describe('looksLikeAServerKey', () => {
  it('passes a genuine anon key', () => {
    expect(looksLikeAServerKey(anonKey)).toBe(false)
  })

  it('passes a publishable key', () => {
    expect(looksLikeAServerKey('sb_publishable_abcdefghijklmnop')).toBe(false)
  })

  it('does not throw on a value that is not a JWT at all', () => {
    expect(looksLikeAServerKey('plain-string')).toBe(false)
    expect(looksLikeAServerKey('a.!!!not-base64!!!.c')).toBe(false)
  })
})
