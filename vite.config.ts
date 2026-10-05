import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * Development only: lets /dev/transaction-detection read bank-messages.local.
 *
 * `apply: 'serve'` keeps it out of `vite build`, so it cannot reach a bundle.
 * It answers GET requests from this computer only — not a phone, not anyone
 * else on the network, even under `npm run dev:phone` — and forbids caching.
 * The file itself stays behind `server.fs.deny` below.
 */
function localBankMessages(): Plugin {
  const file = fileURLToPath(new URL('./bank-messages.local', import.meta.url))
  return {
    name: 'mm:local-bank-messages',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/bank-messages', (request, response) => {
        if (request.method !== 'GET' || !LOOPBACK.has(request.socket.remoteAddress ?? '')) {
          response.statusCode = 403
          response.end()
          return
        }
        readFile(file, 'utf8').then(
          (text) => {
            response.setHeader('Content-Type', 'text/plain; charset=utf-8')
            response.setHeader('Cache-Control', 'no-store')
            response.end(text)
          },
          () => {
            response.statusCode = 404
            response.end()
          },
        )
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localBankMessages()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
  build: {
    // Capacitor packages this directory as `webDir` (capacitor.config.json).
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    fs: {
      // Vite's defaults, plus *.local. The dev server serves files from the
      // project root, and bank-messages.local holds real bank messages — with
      // `npm run dev:phone` that would be readable by anyone on the network.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '*.local'],
    },
  },
})
