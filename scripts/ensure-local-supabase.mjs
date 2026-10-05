#!/usr/bin/env node
/**
 * Runs before `npm run dev` and `npm run dev:phone` (the `predev` hooks).
 *
 * When the app is pointed at the local Supabase stack, the stack has to be
 * running before the dev server is any use. If it is not, every request fails
 * before reaching it, and the sign-in screen says "You appear to be offline" —
 * on the PC and on a phone alike — which sends you looking at the network
 * instead of at Docker. Docker Desktop does not start with Windows by default,
 * so after a reboot this is the normal state, not an edge case.
 *
 * So this script makes the stack answer before Vite starts:
 *
 *   1. Reads `VITE_SUPABASE_URL` exactly as Vite will (`loadEnv`, mode
 *      `development`). A non-local URL — a hosted project — needs nothing from
 *      Docker, and the script exits at once.
 *   2. Asks Auth for its health. If it answers, done.
 *   3. Otherwise starts Docker Desktop if the engine is down, then runs
 *      `npm run db:start` (`supabase start`), which reuses the existing
 *      database volume. It never resets or reseeds; only a database that does
 *      not exist yet is created and seeded, as on a first `db:start`.
 *   4. Waits for Auth to answer, or exits non-zero saying what to do.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = '[local-supabase]'

const DOCKER_START_TIMEOUT_MS = 180_000
/** After Docker starts, containers with `restart: unless-stopped` come back on their own. */
const CONTAINER_RESTART_GRACE_MS = 30_000
const AUTH_READY_TIMEOUT_MS = 90_000

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

const isWindows = process.platform === 'win32'

function log(message) {
  console.log(`${TAG} ${message}`)
}

function fail(message) {
  console.error(`\n${TAG} ${message}\n`)
  console.error(`${TAG} To start Vite without this check: npx vite\n`)
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeoutMs, intervalMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(intervalMs)
  }
  return false
}

async function authIsHealthy(url, anonKey) {
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(3_000),
    })
    return res.ok
  } catch {
    return false
  }
}

function dockerIsRunning() {
  return spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 15_000 }).status === 0
}

function dockerIsInstalled() {
  return spawnSync('docker', ['--version'], { stdio: 'ignore', timeout: 15_000 }).status === 0
}

/** Ask Docker Desktop to start, without waiting; the caller polls `docker info`. */
function requestDockerStart() {
  // The `docker desktop` CLI plugin (Docker Desktop 4.37+) works on every OS.
  const viaCli = spawnSync('docker', ['desktop', 'start', '--detach'], {
    stdio: 'ignore',
    timeout: 30_000,
  })
  if (viaCli.status === 0) return true

  if (isWindows) {
    const exe = join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Docker',
      'Docker',
      'Docker Desktop.exe',
    )
    if (!existsSync(exe)) return false
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  if (process.platform === 'darwin') {
    return spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' }).status === 0
  }
  return false
}

function startSupabaseStack() {
  log('Starting the local Supabase stack (npm run db:start) — existing data is kept…')
  // One fixed command string: `npm` is `npm.cmd` on Windows, which needs a shell.
  const result = spawnSync('npm run db:start', { cwd: ROOT, stdio: 'inherit', shell: true })
  return result.status === 0
}

async function main() {
  const env = loadEnv('development', ROOT, 'VITE_')
  const configured = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? ''

  if (!configured) return // src/config/env.ts reports a missing variable, by name, at startup.
  const url = configured.replace(/\/+$/, '')
  if (!LOOPBACK.has(new URL(url).hostname)) return // A hosted project: nothing local to start.

  if (await authIsHealthy(url, anonKey)) {
    log(`Auth is up at ${url}.`)
    return
  }

  log(`Auth is not answering at ${url}.`)

  let dockerJustStarted = false
  if (!dockerIsRunning()) {
    if (!dockerIsInstalled()) {
      fail(
        'Docker is not installed, and the local Supabase stack runs in it.\n' +
          '    Install Docker Desktop (https://www.docker.com/products/docker-desktop/), then run npm run dev again.',
      )
    }
    log('Docker is not running. Starting Docker Desktop…')
    if (!requestDockerStart()) {
      fail(
        'Could not start Docker. Start Docker Desktop (or the Docker service) yourself, then run npm run dev again.',
      )
    }
    if (!(await waitFor(dockerIsRunning, DOCKER_START_TIMEOUT_MS, 3_000))) {
      fail(
        `Docker did not come up within ${DOCKER_START_TIMEOUT_MS / 1000}s.\n` +
          '    Open Docker Desktop, wait until it says "Engine running", then run npm run dev again.',
      )
    }
    log('Docker is running.')
    dockerJustStarted = true
  }

  if (
    dockerJustStarted &&
    (await waitFor(() => authIsHealthy(url, anonKey), CONTAINER_RESTART_GRACE_MS))
  ) {
    log(`Auth is up at ${url}.`)
    return
  }

  if (!startSupabaseStack()) {
    fail('npm run db:start failed — its output is above. Fix that, then run npm run dev again.')
  }

  if (!(await waitFor(() => authIsHealthy(url, anonKey), AUTH_READY_TIMEOUT_MS))) {
    fail(
      `The stack started, but Auth still does not answer at ${url}.\n` +
        '    Check `npx supabase status` and the URL and anon key in .env.local, then run npm run dev again.',
    )
  }
  log(`Auth is up at ${url}.`)
}

await main()
