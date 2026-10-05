import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '@/app/App'
import { env, MODE } from '@/config/env'
import { initObservability } from '@/lib/observability/sentry'
import '@/styles/globals.css'

/**
 * Startup order matters: configuration is validated first, so a misconfigured
 * build fails with a message naming the variable rather than rendering a blank
 * screen; observability is initialised second, so an error thrown during the
 * first render is still reported.
 */
initObservability(env, MODE)

const container = document.getElementById('root')
if (!container) {
  throw new Error('index.html is missing #root; the app has nowhere to mount.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
