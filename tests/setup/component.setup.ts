import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { stubTestEnv } from './env'
import { server } from './msw/server'

stubTestEnv()

// `onUnhandledRequest: 'error'` is the point of the harness: a component that
// starts talking to an endpoint nobody declared fails the test rather than
// hanging or silently succeeding (TESTING.md 5).
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
})

afterAll(() => server.close())
