#!/usr/bin/env node
/**
 * The dependency gate — SECURITY.md §8.3. Run by the `security` CI job.
 *
 * `npm audit --audit-level=high` alone cannot pass when an advisory has no
 * fixed version anywhere: there is nothing to upgrade to, and the only way to
 * green the build would be to lower the threshold for every package. So the
 * gate is two audits:
 *
 *   1. **What ships.** Production dependencies: any high or critical advisory
 *      fails. No exceptions, ever — this is the code in the user's browser.
 *   2. **Everything.** Dev tooling included: any high or critical advisory
 *      fails unless it is listed in EXCEPTIONS below, with the reason it cannot
 *      reach anything that matters and a date to look again. An exception past
 *      that date fails, so none of them outlive the reasoning behind them.
 *
 * An exception is for an advisory with **no fixed version**. If a fix exists,
 * upgrade the package (`npm audit fix`, run in a clean Linux container — see
 * README "Regenerating the lockfile") instead of adding a line here.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BLOCKING = new Set(['high', 'critical'])

const EXCEPTIONS = [
  {
    id: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    reason:
      'Stack exhaustion from deeply nested brace patterns; every published version is affected. ' +
      'Reached only through micromatch in eslint-plugin-boundaries and lint-staged, which ' +
      'expand glob patterns from this repository’s own config — never from user input.',
    reviewBy: '2027-01-31',
  },
]

/**
 * `npm audit --json`, whatever the exit code: npm exits non-zero when it finds
 * anything. One fixed command string through the shell, so `npm` resolves to
 * `npm.cmd` on Windows; nothing in it comes from input.
 */
function audit(flags) {
  const result = spawnSync(`npm audit --json ${flags}`, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  try {
    return JSON.parse(result.stdout)
  } catch {
    process.stderr.write(`audit-dependencies: npm audit gave no JSON.\n${result.stderr}\n`)
    process.exit(1)
  }
}

/** Every high or critical advisory in a report, once each, keyed by its GHSA id. */
function blockingAdvisories(report) {
  const found = new Map()
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via) {
      // A string `via` is a dependency path; the advisory itself is listed under that package.
      if (typeof via === 'string' || !BLOCKING.has(via.severity)) continue
      const id = via.url.split('/').pop()
      found.set(id, { id, package: via.name, severity: via.severity, title: via.title })
    }
  }
  return [...found.values()]
}

const describe = (a) => `  ${a.severity} ${a.package} — ${a.title} (${a.id})`
const problems = []
const today = new Date().toISOString().slice(0, 10)

const shipped = blockingAdvisories(audit('--omit=dev'))
for (const advisory of shipped) problems.push(`${describe(advisory)} — in a production dependency`)

for (const advisory of blockingAdvisories(audit(''))) {
  if (shipped.some((s) => s.id === advisory.id)) continue
  const exception = EXCEPTIONS.find((e) => e.id === advisory.id && e.package === advisory.package)
  if (exception === undefined) problems.push(describe(advisory))
  else if (exception.reviewBy < today) {
    problems.push(`${describe(advisory)} — exception expired ${exception.reviewBy}; re-check it`)
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `audit-dependencies: ${problems.length} blocking advisor${problems.length === 1 ? 'y' : 'ies'}:\n` +
      `${problems.join('\n')}\n\nUpgrade the package. Do not add an exception for an advisory ` +
      `that has a fixed version.\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `audit-dependencies: no blocking advisories in production dependencies; ` +
    `${EXCEPTIONS.length} documented dev-tool exception${EXCEPTIONS.length === 1 ? '' : 's'}.\n`,
)
