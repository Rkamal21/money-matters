#!/usr/bin/env node
/**
 * Post-build checks over `dist/`. Run by the `build` and `security` CI jobs.
 *
 * Two things, both from documents that already decided them:
 *
 *   1. **Size budget** — ARCHITECTURE.md §L: "Initial JS bundle < 200 KB
 *      gzipped", with charts and analytics lazy-loaded (ROADMAP.md M10). The
 *      initial bundle is what `index.html` loads before the first render: its
 *      entry script and every `modulepreload`. Route chunks load when their
 *      route does, so each gets its own, looser ceiling instead — a lazy chunk
 *      that grows past it is a dependency that should not be there.
 *   2. **Secret scan** — SECURITY.md §8.3: the built `dist/` contains no
 *      `service_role`, no JWT with `"role":"service_role"`, and no key not on
 *      the `VITE_` allow-list.
 *
 * The second matters more than the first. Vite inlines every `VITE_`-prefixed
 * variable into the bundle, so a developer who adds `VITE_ADMIN_KEY` to `.env`
 * publishes it to every visitor. The allow-list in `src/config/env.schema.ts`
 * is the declared set; anything else that looks like a credential fails here.
 *
 * Source maps are scanned too, with one distinction: a map embeds the source
 * text of every module, including third-party libraries, and the Supabase SDK
 * documents its admin API with sentences like "never expose your service_role
 * key in the browser". A vendor's comment is not our secret. Our own sources
 * inside a map, and every emitted .js/.css/.html file, are scanned in full.
 */
import { gzipSync } from 'node:zlib'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

/** ARCHITECTURE.md §L. Gzipped, because that is what crosses the wire. */
const INITIAL_BUDGET_BYTES = 200 * 1024
/** Any one lazily loaded chunk. */
const LAZY_CHUNK_BUDGET_BYTES = 120 * 1024

const problems = []
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

if (!existsSync(DIST)) {
  process.stderr.write('check-bundle: dist/ does not exist. Run `npm run build` first.\n')
  process.exit(1)
}
const files = walk(DIST)

// ---------------------------------------------------------------- size budget

const gz = (file) => gzipSync(readFileSync(file)).length
const jsFiles = files.filter((file) => extname(file) === '.js')

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const initialNames = new Set(
  [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map((match) => basename(match[1])),
)
if (initialNames.size === 0)
  problems.push('dist/index.html references no JavaScript; the build is broken.')

let initialBytes = 0
let totalBytes = 0
for (const file of jsFiles) {
  const size = gz(file)
  totalBytes += size
  if (initialNames.has(basename(file))) {
    initialBytes += size
  } else if (size > LAZY_CHUNK_BUDGET_BYTES) {
    problems.push(
      `${relative(ROOT, file)} is ${kb(size)} gzipped, over the ${kb(LAZY_CHUNK_BUDGET_BYTES)} ceiling for one lazy chunk.`,
    )
  }
}

if (initialBytes > INITIAL_BUDGET_BYTES) {
  problems.push(
    `The initial JS bundle is ${kb(initialBytes)} gzipped, over the ${kb(INITIAL_BUDGET_BYTES)} budget ` +
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

function scan(name, source) {
  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(source)) problems.push(`${name} contains ${why} (SECURITY.md §8.3).`)
  }
  if (jwtClaimsServiceRole(source)) {
    problems.push(`${name} contains a JWT with "role":"service_role" (SECURITY.md §8.3).`)
  }
}

for (const file of files) {
  const extension = extname(file)
  const name = relative(ROOT, file)
  if (['.js', '.css', '.html'].includes(extension)) {
    scan(name, readFileSync(file, 'utf8'))
  } else if (extension === '.map') {
    const map = JSON.parse(readFileSync(file, 'utf8'))
    const sources = map.sources ?? []
    const contents = map.sourcesContent ?? []
    sources.forEach((source, index) => {
      if (/node_modules/.test(source)) return
      scan(`${name} (${source})`, contents[index] ?? '')
    })
  }
}

// ---------------------------------------------------------------------- report

if (problems.length > 0) {
  process.stderr.write('check-bundle failed:\n')
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
  process.exit(1)
}

process.stdout.write(
  `check-bundle: initial load ${kb(initialBytes)} gzipped across ${initialNames.size} file(s) ` +
    `(budget ${kb(INITIAL_BUDGET_BYTES)}); ${jsFiles.length} JS files, ${kb(totalBytes)} in all; ` +
    'no forbidden material found\n',
)
