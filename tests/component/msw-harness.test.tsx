import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { TEST_SUPABASE_URL } from '../setup/env'
import { server } from '../setup/msw/server'

/**
 * Proves the MSW harness (ROADMAP.md — Milestone 0: "each proven with one real
 * test").
 *
 * There are no repositories at Milestone 0, so the subject is a component
 * defined here rather than product code. What is being asserted is the property
 * every later component test depends on: a component's real fetch is
 * intercepted, a per-test override wins over the default handler, and an
 * endpoint nobody declared fails the test instead of escaping to the network.
 */
function ProbeStatus({ path }: { path: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch(`${TEST_SUPABASE_URL}${path}`)
      .then((response) => {
        if (!cancelled) setState(response.ok ? 'ok' : 'failed')
      })
      .catch(() => {
        if (!cancelled) setState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return <output>{state}</output>
}

describe('MSW harness', () => {
  it('intercepts a component fetch with the default handler', async () => {
    render(<ProbeStatus path="/rest/v1/" />)

    expect(screen.getByRole('status')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ok'))
  })

  it('lets a single test override the default handler', async () => {
    server.use(
      http.get(`${TEST_SUPABASE_URL}/rest/v1/`, () =>
        HttpResponse.json({ message: 'permission denied' }, { status: 403 }),
      ),
    )

    render(<ProbeStatus path="/rest/v1/" />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('failed'))
  })

  it('refuses an undeclared endpoint rather than letting it reach the network', async () => {
    const unhandled = new Promise<string>((resolve) => {
      server.events.on('request:unhandled', ({ request }: { request: Request }) => {
        resolve(request.url)
      })
    })

    render(<ProbeStatus path="/rest/v1/transactions" />)

    await expect(unhandled).resolves.toContain('/rest/v1/transactions')
  })
})
