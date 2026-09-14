#!/usr/bin/env node
/**
 * Generate the default-category constants from the authoritative block in
 * `supabase/seed.sql`.
 *
 * Why this exists: ARCHITECTURE.md §R.5 identifies category slugs as the one
 * place business data was duplicated in v1 — once in SQL, once in TypeScript —
 * and resolves it by making the SQL authoritative and generating the TypeScript.
 * ROADMAP.md puts the script in Milestone 0 "before there are two lists to
 * drift", and TESTING.md §4.4 makes the no-diff check a CI job.
 *
 * It emits two artefacts, because two places need the list and neither may own
 * it (ADR-0023):
 *
 *   src/config/categories.generated.ts       the TypeScript constants
 *   supabase/generated/default_categories.sql  the canonical SQL VALUES rows
 *
 * The SQL artefact exists because migrations are forward-only and immutable
 * once merged (DATABASE.md §13 rule 1), so `handle_new_user()` cannot `\i` a
 * file that may later change — it has to carry the rows literally. `--check`
 * therefore also verifies every marked block inside `supabase/migrations/`
 * against the generated fragment, and refuses any migration that writes a
 * second, independent category list. The copy is allowed; drift is not.
 *
 *   node scripts/generate-category-constants.mjs            # write
 *   node scripts/generate-category-constants.mjs --check    # fail on a diff
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SEED_PATH = join(ROOT, 'supabase', 'seed.sql')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const TS_OUTPUT_PATH = join(ROOT, 'src', 'config', 'categories.generated.ts')
const SQL_OUTPUT_PATH = join(ROOT, 'supabase', 'generated', 'default_categories.sql')

const BEGIN_MARKER = '>>> BEGIN DEFAULT CATEGORIES'
const END_MARKER = '<<< END DEFAULT CATEGORIES'

/** The markers a migration wraps its copy of the rows in. */
const SQL_BEGIN_MARKER = '>>> BEGIN GENERATED DEFAULT CATEGORIES'
const SQL_END_MARKER = '<<< END GENERATED DEFAULT CATEGORIES'

/**
 * System merchant rules name categories by slug, legitimately and many times
 * over, which the "writes its own category list" heuristic below would
 * misread as a second list. So the rules block is exempt from that heuristic —
 * and held to a stricter rule instead: every slug in it must be a default
 * category, or a rule would point at a category no user has.
 */
const MERCHANT_BEGIN_MARKER = '>>> BEGIN SYSTEM MERCHANT RULES'
const MERCHANT_END_MARKER = '<<< END SYSTEM MERCHANT RULES'

/** One rule: ('pattern', 'match_type', 'Label', 'slug', confidence) */
const MERCHANT_ROW =
  /^\(\s*'((?:[^']|'')+)'\s*,\s*'(contains|prefix|exact)'\s*,\s*'((?:[^']|'')+)'\s*,\s*'([a-z0-9_]{1,40})'\s*,\s*([01](?:\.\d+)?)\s*\),?$/

/** One row: ('slug', 'Name', 'kind', 'treatment', 'icon', 'color', position) */
const ROW =
  /^\(\s*'([a-z0-9_]{1,40})'\s*,\s*'([^']+)'\s*,\s*'(expense|income)'\s*,\s*'(fixed|variable|excluded)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*\),?$/

function fail(message) {
  process.stderr.write(`generate-category-constants: ${message}\n`)
  process.exit(1)
}

function extractBlock(text, begin, end, what) {
  const start = text.indexOf(begin)
  const stop = text.indexOf(end)
  if (start === -1 || stop === -1 || stop < start) return null
  if (what === undefined) return text.slice(start + begin.length, stop)
  return text.slice(start + begin.length, stop)
}

function parseCategories(block) {
  const categories = []

  for (const rawLine of block.split(/\r?\n/)) {
    // Every line in the block is a SQL comment; strip the marker, then skip
    // the header line and anything blank.
    const line = rawLine.replace(/^\s*--\s?/, '').trim()
    if (line === '' || !line.startsWith('(')) continue
    if (line.startsWith('(slug')) continue

    const match = ROW.exec(line)
    if (!match) fail(`unparseable row in the default-category block:\n  ${line}`)

    const [, slug, name, kind, treatment, icon, color, position] = match
    categories.push({ slug, name, kind, treatment, icon, color, position: Number(position) })
  }

  if (categories.length === 0) fail('the default-category block is empty')

  const slugs = new Set()
  for (const category of categories) {
    if (slugs.has(category.slug)) fail(`duplicate slug "${category.slug}"`)
    slugs.add(category.slug)
  }

  const positions = categories.map((category) => category.position)
  if (new Set(positions).size !== positions.length) fail('duplicate position in the block')

  return categories
}

function renderTypeScript(categories) {
  const rows = categories
    .map(
      (category) =>
        `  {\n` +
        `    slug: '${category.slug}',\n` +
        `    name: '${category.name.replace(/'/g, "\\'")}',\n` +
        `    kind: '${category.kind}',\n` +
        `    treatment: '${category.treatment}',\n` +
        `    icon: '${category.icon}',\n` +
        `    color: '${category.color}',\n` +
        `    position: ${category.position},\n` +
        `  },`,
    )
    .join('\n')

  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: supabase/seed.sql, between the DEFAULT CATEGORIES markers.
 * Regenerate: npm run gen:categories
 * Verified in CI: npm run gen:categories -- --check
 *
 * The SQL is authoritative (ARCHITECTURE.md §R.5, ADR-0023). Editing this file
 * by hand only means the next \`--check\` run fails.
 */

export interface DefaultCategory {
  readonly slug: string
  readonly name: string
  readonly kind: 'expense' | 'income'
  readonly treatment: 'fixed' | 'variable' | 'excluded'
  readonly icon: string
  readonly color: string
  readonly position: number
}

export const DEFAULT_CATEGORIES = [
${rows}
] as const satisfies readonly DefaultCategory[]

export type DefaultCategorySlug = (typeof DEFAULT_CATEGORIES)[number]['slug']

export const DEFAULT_CATEGORY_SLUGS: readonly DefaultCategorySlug[] = DEFAULT_CATEGORIES.map(
  (category) => category.slug,
)
`
}

/** The rows only — this exact text is what a migration must carry. */
function renderSqlRows(categories) {
  return categories
    .map(
      (category, index) =>
        `  ('${category.slug}', '${category.name.replace(/'/g, "''")}', ` +
        `'${category.kind}', '${category.treatment}', ` +
        `'${category.icon}', '${category.color}', ${category.position})` +
        (index === categories.length - 1 ? '' : ','),
    )
    .join('\n')
}

function renderSqlFile(categories) {
  return `-- GENERATED FILE — DO NOT EDIT.
--
-- Source: supabase/seed.sql, between the DEFAULT CATEGORIES markers.
-- Regenerate: npm run gen:categories
-- Verified in CI: npm run gen:categories -- --check
--
-- Migrations are forward-only and immutable once merged (DATABASE.md §13), so a
-- migration cannot include a file that may change underneath it: it has to
-- carry these rows literally. Paste the marked block below, markers included,
-- into the migration that needs it — \`handle_new_user()\` in Milestone 1.
--
-- \`--check\` compares every marked block under supabase/migrations/ against
-- this file and fails on any difference, and refuses a migration that writes a
-- second, independent category list. The copy is allowed; drift is not.
-- See ADR-0023.
--
-- Columns are DATABASE.md §6.3:
--   (slug, name, kind, treatment, icon, color, position)

-- ${SQL_BEGIN_MARKER}
${renderSqlRows(categories)}
-- ${SQL_END_MARKER}
`
}

/**
 * Refuse a migration that writes its own category list.
 *
 * Deliberately a heuristic: "is this a category list" is not decidable, so the
 * test is three or more distinct default slugs appearing as SQL string literals
 * outside a marked block. One slug in a comment or a `WHERE` clause is fine;
 * three is a list.
 */
function checkMigrations(categories) {
  const canonical = renderSqlRows(categories).trim()
  const slugs = categories.map((category) => category.slug)
  const problems = []

  let files
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql'))
  } catch {
    return problems
  }

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file)
    const sql = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

    const marked = extractBlock(sql, SQL_BEGIN_MARKER, SQL_END_MARKER)
    if (marked !== null) {
      const body = marked
        .split('\n')
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim()
      if (body !== canonical) {
        problems.push(
          `supabase/migrations/${file}: its generated default-category block does not match ` +
            `${relative(ROOT, SQL_OUTPUT_PATH)}. Re-copy the block; do not edit it in place.`,
        )
      }
    }

    let outsideBlocks =
      marked === null
        ? sql
        : sql.slice(0, sql.indexOf(SQL_BEGIN_MARKER)) +
          sql.slice(sql.indexOf(SQL_END_MARKER) + SQL_END_MARKER.length)

    const rules = extractBlock(outsideBlocks, MERCHANT_BEGIN_MARKER, MERCHANT_END_MARKER)
    if (rules !== null) {
      for (const rawLine of rules.split('\n')) {
        const line = rawLine.trim()
        if (line === '' || line.startsWith('--')) continue
        const match = MERCHANT_ROW.exec(line)
        if (!match) {
          problems.push(`supabase/migrations/${file}: unparseable merchant rule:\n    ${line}`)
        } else if (!slugs.includes(match[4])) {
          problems.push(
            `supabase/migrations/${file}: merchant rule "${match[1]}" names category ` +
              `"${match[4]}", which is not a default category slug.`,
          )
        }
      }
      outsideBlocks =
        outsideBlocks.slice(0, outsideBlocks.indexOf(MERCHANT_BEGIN_MARKER)) +
        outsideBlocks.slice(outsideBlocks.indexOf(MERCHANT_END_MARKER) + MERCHANT_END_MARKER.length)
    }

    const found = slugs.filter((slug) => outsideBlocks.includes(`'${slug}'`))
    if (found.length >= 3) {
      problems.push(
        `supabase/migrations/${file}: writes its own category list ` +
          `(${found.slice(0, 4).join(', ')}…) outside the generated block. ` +
          'The list lives in supabase/seed.sql and nowhere else (ADR-0023).',
      )
    }
  }

  return problems
}

// ----------------------------------------------------------------------------

const seed = readFileSync(SEED_PATH, 'utf8')
const block = extractBlock(seed, BEGIN_MARKER, END_MARKER)
if (block === null) {
  fail(
    `could not find the "${BEGIN_MARKER}" / "${END_MARKER}" markers in ` +
      `${relative(ROOT, SEED_PATH)}. That block is the source of truth for the ` +
      'default categories; see ARCHITECTURE.md §R.5 and ADR-0023.',
  )
}

const categories = parseCategories(block)
const artefacts = [
  { path: TS_OUTPUT_PATH, contents: renderTypeScript(categories) },
  { path: SQL_OUTPUT_PATH, contents: renderSqlFile(categories) },
]

if (process.argv.includes('--check')) {
  const problems = []

  for (const { path, contents } of artefacts) {
    let committed
    try {
      committed = readFileSync(path, 'utf8')
    } catch {
      problems.push(`${relative(ROOT, path)} does not exist. Run \`npm run gen:categories\`.`)
      continue
    }
    // Normalise line endings: committed with LF, handed back as CRLF on Windows.
    if (committed.replace(/\r\n/g, '\n') !== contents) {
      problems.push(
        `${relative(ROOT, path)} is out of date with supabase/seed.sql. ` +
          'Run `npm run gen:categories` and commit the result.',
      )
    }
  }

  problems.push(...checkMigrations(categories))

  if (problems.length > 0) {
    process.stderr.write('generate-category-constants --check failed:\n')
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
    process.exit(1)
  }

  process.stdout.write(
    `category constants are up to date (${categories.length} categories; ` +
      'TypeScript, SQL, and every migration block agree)\n',
  )
} else {
  for (const { path, contents } of artefacts) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents, 'utf8')
    process.stdout.write(`wrote ${relative(ROOT, path)}\n`)
  }
}
