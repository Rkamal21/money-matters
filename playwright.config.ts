import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

const webServer = process.env.E2E_BASE_URL
  ? undefined
  : {
      command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    }

/**
 * Local escape hatch for a machine that cannot reach Playwright's browser CDN.
 *
 *   E2E_BROWSER_CHANNEL=chrome npm run test:e2e
 *
 * runs against an already-installed Chrome or Edge instead of the pinned
 * Chromium build. Unset in CI, which installs the pinned build and must keep
 * doing so — a locally installed browser is whatever that machine happens to
 * have, which is not what "the tests pass" should depend on. Video recording is
 * disabled with it, because ffmpeg ships in the same download that failed.
 */
const channel = process.env.E2E_BROWSER_CHANNEL

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: channel ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      // Mobile-first: base styles target 360px, so that is what CI verifies.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], ...(channel ? { channel } : {}) },
    },
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) },
    },
  ],
  ...(webServer ? { webServer } : {}),
})
