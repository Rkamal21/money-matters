import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
}

export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Only the layers that exist in Milestone 0. Raise these as layers land;
      // TESTING.md sets the real targets (domain 100%, features 80%).
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/**/index.ts'],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
          setupFiles: ['./tests/setup/unit.setup.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx', 'tests/component/**/*.test.tsx'],
          setupFiles: ['./tests/setup/component.setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          // Hits a real local Supabase (`npm run db:start`). Never runs in the
          // default `npm test` -- see TESTING.md 4.
          include: ['tests/integration/**/*.test.ts', 'tests/rls/**/*.test.ts'],
          setupFiles: ['./tests/setup/integration.setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // One database, one connection pool: these suites must not interleave.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
})
