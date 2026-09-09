#!/usr/bin/env node
/**
 * Post-build checks over `dist/`. Run by the `build` and `security` CI jobs.
 *
 * Two things, both from documents that already decided them:
 *
 *   1. **Size budget** — ARCHITECTURE.md §L: "Initial JS bundle < 200 KB
 *      gzipped. CI size check, fails the build."
 *   2. **Secret scan** — SECURITY.md §8.3: the built `dist/` contains no
 *      `service_role`, no JWT with `"role":"service_role"`, and no key not on
 *      the `VITE_` allow-list.
 *
 * The second matters more than the first. Vite inlines every `VITE_`-prefixed
 * variable into the bundle, so a developer who adds `VITE_ADMIN_KEY` to `.env`
 * publishes it to every visitor. The allow-list in `src/config/env.schema.ts`
 * is the declared set; anything else that looks like a credential fails here.
 */
import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

/** ARCHITECTURE.md §L. Gzipped, because that is what crosses the wire. */
const JS_BUDGET_BYTES = 200 * 1024

const problems = []

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

let files
try {
  files = walk(DIST)
} catch {
  process.stderr.write('check-bundle: dist/ does not exist. Run `npm run build` first.\n')
  process.exit(1)
}

// ---------------------------------------------------------------- size budget

const jsFiles = files.filter((file) => extname(file) === '.js')
const gzippedTotal = jsFiles.reduce((total, file) => total + gzipSync(readFileSync(file)).length, 0)

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

if (gzippedTotal > JS_BUDGET_BYTES) {
  problems.push(
    `JS bundle is ${kb(gzippedTotal)} gzipped, over the ${kb(JS_BUDGET_BYTES)} budget ` +
      '(ARCHITECTURE.md §L).',
  )
}

// ----------------------------------------------------------------- secret scan

/**
 * Patterns that must never appear in a client bundle.
 * `service_role` covers both the literal string and a decoded JWT claim; the
 * base64 form is checked separately because the JWT arrives encoded.
 */
const FORBIDDEN = [
  { pattern: /service_role/, why: 'a service_role reference' },
  { pattern: /sb_secret_[A-Za-z0-9_-]{8,}/, why: 'a Supabase secret key' },
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, why: 'a private key' },
  { pattern: /\bSUPABASE_SERVICE_ROLE_KEY\b/, why: 'a service-role env var name' },
]

/** Decode every JWT-looking token and check its `role` claim. */
function jwtClaimsServiceRole(source) {
  const matches = source.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []
  for (const token of matches) {
    const payload = token.split('.')[1]
    try {
      const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
      if (/"role"\s*:\s*"service_role"/.test(json)) return true
    } catch {
      // Not decodable: not a JWT we can judge, and not a service_role one.
    }
  }
  return false
}

for (const file of files) {
  if (!['.js', '.css', '.html', '.map'].includes(extname(file))) continue
  const source = readFileSync(file, 'utf8')
  const name = relative(ROOT, file)

  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(source)) problems.push(`${name} contains ${why} (SECURITY.md §8.3).`)
  }

  if (jwtClaimsServiceRole(source)) {
    problems.push(`${name} contains a JWT with "role":"service_role" (SECURITY.md §8.3).`)
  }
}

// ---------------------------------------------------------------------- report

if (problems.length > 0) {
  process.stderr.write('check-bundle failed:\n')
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
  process.exit(1)
}

process.stdout.write(
  `check-bundle: ${jsFiles.length} JS file(s), ${kb(gzippedTotal)} gzipped ` +
    `(budget ${kb(JS_BUDGET_BYTES)}); no forbidden material found\n`,
)
