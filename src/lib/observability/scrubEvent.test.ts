import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { redactText, redactUrl, scrubEvent } from './scrubEvent'

/** Everything in this list appearing in a Sentry payload is an incident. */
const BANNED_SUBSTRINGS = [
  'amount_minor',
  'amountMinor',
  'access_token',
  'refresh_token',
  'merchant',
  'description',
  '@example.com',
  'eyJhbGciOi',
  'Swiggy',
] as const

function serialise(value: unknown): string {
  return JSON.stringify(value ?? null)
}

describe('scrubEvent', () => {
  // SECURITY.md §8.3, verbatim: "a unit test feeds a payload containing
  // amount_minor, email, and access_token through the Sentry beforeSend hook
  // and asserts all three are removed."
  it('removes amount_minor, email and access_token from a realistic event', () => {
    const event = {
      event_id: 'abc123',
      level: 'error',
      release: '2.0.0-alpha.0',
      user: {
        id: '0f9c1a4e-1111-4222-8333-444455556666',
        email: 'priya@example.com',
        ip_address: '203.0.113.7',
      },
      extra: {
        amount_minor: 4500000,
        merchant: 'UPI/SWIGGY/423512/PAYTM',
        access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        correlationId: 'c-8f3a12',
        kind: 'conflict',
      },
      tags: { email: 'priya@example.com', route: '/transactions', code: '23505' },
      request: {
        url: 'https://app.example.com/transactions?q=swiggy&access_token=eyJhbGciOiJIUzI1NiJ9.x.y',
        method: 'POST',
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' },
        data: { amount_minor: 4500000, description: 'dinner' },
      },
      breadcrumbs: [
        {
          type: 'default',
          category: 'console',
          level: 'log',
          message: 'Transaction SMS | amount=4500 | message=Rs.4500 debited',
          data: { amount_minor: 4500000, route: '/transactions', outcome: 'error' },
        },
      ],
    }

    const scrubbed = scrubEvent(event)
    const json = serialise(scrubbed)

    for (const banned of BANNED_SUBSTRINGS) {
      expect(json, `"${banned}" survived scrubbing`).not.toContain(banned)
    }
  })

  it('keeps the fields error tracking is supposed to carry', () => {
    const scrubbed = scrubEvent({
      event_id: 'abc123',
      level: 'error',
      release: '2.0.0-alpha.0',
      environment: 'production',
      extra: { kind: 'conflict', code: '23505', correlationId: 'c-8f3a12' },
      tags: { route: '/budget' },
      exception: {
        values: [{ type: 'AppError', value: 'conflict', stacktrace: { frames: [] } }],
      },
    })

    expect(scrubbed['release']).toBe('2.0.0-alpha.0')
    expect(scrubbed['extra']).toEqual({
      kind: 'conflict',
      code: '23505',
      correlationId: 'c-8f3a12',
    })
    expect(scrubbed['tags']).toEqual({ route: '/budget' })
    expect(serialise(scrubbed['exception'])).toContain('stacktrace')
  })

  it('reduces user to an id, because the id correlates and the email does not', () => {
    const scrubbed = scrubEvent({
      user: { id: 'u-1', email: 'priya@example.com', username: 'priya', ip_address: '203.0.113.7' },
    })

    expect(scrubbed['user']).toEqual({ id: 'u-1' })
  })

  it('drops a key a future SDK version adds, rather than forwarding it', () => {
    const scrubbed = scrubEvent({ event_id: 'e1', some_future_field: { secret: 'value' } })

    expect(scrubbed['some_future_field']).toBeUndefined()
  })

  it('drops the console breadcrumb message that leaked a whole bank SMS in v1', () => {
    const scrubbed = scrubEvent({
      breadcrumbs: [{ category: 'console', message: 'Rs.4500 debited from A/c XX1234' }],
    })

    expect(serialise(scrubbed)).not.toContain('debited')
  })

  it('survives a null-ish or malformed event without throwing', () => {
    expect(() => scrubEvent({})).not.toThrow()
    expect(() => scrubEvent({ exception: 'not-an-object', user: 42, tags: [] })).not.toThrow()
  })
})

describe('scrubEvent property: no allow-listed key means no value', () => {
  /** Arbitrary nested JSON, with plenty of forbidden key names mixed in. */
  const dangerousJson = fc.letrec<{ node: unknown }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.integer(),
      fc.boolean(),
      fc.oneof(
        fc.string(),
        fc.constant('priya@example.com'),
        fc.constant('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'),
        fc.constant('₹45,000.00'),
      ),
      fc.array(tie('node'), { maxLength: 4 }),
      fc.dictionary(
        fc.oneof(
          fc.constantFrom('amount_minor', 'email', 'access_token', 'merchant', 'note'),
          fc.string({ minLength: 1 }),
        ),
        tie('node'),
        { maxKeys: 5 },
      ),
    ),
  })).node

  it('never emits a forbidden key or a token/email/amount, for any payload shape', () => {
    fc.assert(
      fc.property(dangerousJson, dangerousJson, (extra, tags) => {
        const json = serialise(scrubEvent({ extra, tags }))

        for (const banned of ['amount_minor', 'access_token', 'merchant', '@example.com']) {
          if (json.includes(banned)) return false
        }
        return !json.includes('eyJhbGciOi') && !json.includes('45,000')
      }),
      { numRuns: 300, seed: 20260909 },
    )
  })
})

describe('redactText', () => {
  it('redacts a JWT, an email, a rupee amount and a long digit run', () => {
    const text = redactText(
      'user priya@example.com paid ₹4,500 with eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig ref 987654',
    )

    expect(text).not.toContain('priya@example.com')
    expect(text).not.toContain('4,500')
    expect(text).not.toContain('eyJhbGciOi')
    expect(text).not.toContain('987654')
  })

  it('leaves an ordinary diagnostic message readable', () => {
    expect(redactText('Network request failed after 3 retries')).toBe(
      'Network request failed after 3 retries',
    )
  })
})

describe('redactUrl', () => {
  it('keeps the path shape and drops the query string', () => {
    expect(
      redactUrl('https://app.example.com/goals/0f9c1a4e-1111-4222-8333-444455556666?token=x'),
    ).toBe('https://app.example.com/goals/:id')
  })

  it('collapses numeric path segments', () => {
    expect(redactUrl('/transactions/12345/edit')).toBe('/transactions/:id/edit')
  })

  it('never throws on a value that is not a URL', () => {
    expect(redactUrl('::::')).toBe('/::::')
  })
})
