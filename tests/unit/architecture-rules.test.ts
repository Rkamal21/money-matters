import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { ESLint } from 'eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The lint rules are themselves tested.
 *
 * Two of Milestone 0's acceptance criteria are statements about lint:
 *
 *   - "A PR that puts `(income - fixed) / 30` in a component **fails lint**,
 *     not review"
 *   - "A PR that imports `supabase` into a component **fails lint**"
 *
 * A green `npm run lint` proves neither, because the codebase contains no
 * violations. What proves it is feeding a violation to ESLint and asserting it
 * is rejected — which doubles as the regression test for the day someone
 * reorders `eslint.config.js` and quietly turns a rule into a no-op. That is
 * not hypothetical: `boundaries/dependencies` silently classified every import
 * as "unknown", and reported nothing at all, until the TypeScript resolver was
 * configured.
 *
 * Fixtures are written to real paths under `src/` and deleted afterwards. They
 * have to be real files: type-aware parsing rejects a path the project service
 * has never heard of, and `boundaries` can only classify an import it can
 * resolve.
 */

const ROOT = resolve(import.meta.dirname, '..', '..')

/** Everything created here is removed in `afterAll`. */
const FIXTURE_DIRS = [
  join(ROOT, 'src/features/__arch_a'),
  join(ROOT, 'src/features/__arch_b'),
  join(ROOT, 'src/components/__arch'),
  join(ROOT, 'src/domain/__arch'),
]

const FIXTURES: Record<string, string> = {
  // The target of the cross-layer imports below. Deliberately boring.
  'src/features/__arch_b/thing.ts': `export const thing = 'thing'\n`,

  'src/features/__arch_a/components/SafeDaily.tsx': `
export function SafeDaily({ income, fixed }: { income: number; fixed: number }) {
  const safeDaily = (income - fixed) / 30
  return <p>{safeDaily}</p>
}
`,
  'src/components/__arch/PerDay.tsx': `
export function PerDay({ balance, days }: { balance: number; days: number }) {
  return <p>{balance / days}</p>
}
`,
  'src/features/__arch_a/hooks/useRows.ts': `
import { supabase } from '@/data/supabase/client'
export const rows = () => supabase
`,
  'src/components/__arch/Client.tsx': `
import { createClient } from '@supabase/supabase-js'
export const c = createClient
`,
  'src/features/__arch_a/hooks/useNative.ts': `
import { Preferences } from '@capacitor/preferences'
export const p = Preferences
`,
  'src/domain/__arch/impure.ts': `
import { useState } from 'react'
export const x = useState
`,
  'src/domain/__arch/clock.ts': `
export const now = () => new Date().getTime() + Date.now()
`,
  'src/domain/__arch/random.ts': `
export const pick = () => Math.random()
`,
  'src/domain/__arch/reachesUp.ts': `
import { thing } from '@/data/repositories/GoalRepository'
export const x = thing
`,
  'src/features/__arch_a/hooks/useEnv.ts': `
export const url = import.meta.env.VITE_SUPABASE_URL
`,
  'src/features/__arch_a/hooks/useLog.ts': `
export const f = () => { console.log('amount', 4500) }
`,
  // Layering: a shared component must not reach into a feature...
  'src/components/__arch/Reaches.ts': `
import { thing } from '@/features/__arch_b/thing'
export const x = thing
`,
  // ...and one feature must not import another.
  'src/features/__arch_a/hooks/useOther.ts': `
import { thing } from '@/features/__arch_b/thing'
export const x = thing
`,
  // The control: the same arithmetic is correct inside domain/.
  'src/domain/__arch/calculate.ts': `
export const safeDaily = (incomeMinor: bigint, fixedMinor: bigint, days: bigint) =>
  (incomeMinor - fixedMinor) / days
`,
}

let eslint: ESLint

beforeAll(async () => {
  for (const [relativePath, contents] of Object.entries(FIXTURES)) {
    const absolute = join(ROOT, relativePath)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents.trimStart(), 'utf8')
  }
  eslint = new ESLint({ cwd: ROOT })

  // The first lint bootstraps the TypeScript project service, which parses the
  // whole program and takes several seconds; every call after it takes tens of
  // milliseconds. Paying that here rather than inside whichever test happens to
  // run first is what stops this suite intermittently timing out.
  await eslint.lintFiles([join(ROOT, 'src/features/__arch_b/thing.ts')])
}, 120_000)

afterAll(() => {
  for (const dir of FIXTURE_DIRS) rmSync(dir, { recursive: true, force: true })
})

async function rulesFor(relativePath: string): Promise<string[]> {
  const [result] = await eslint.lintFiles([join(ROOT, relativePath)])
  const messages = result?.messages ?? []

  const fatal = messages.find((message) => message.fatal)
  if (fatal) throw new Error(`ESLint could not parse ${relativePath}: ${fatal.message}`)

  return messages.map((message) => message.ruleId ?? 'unknown')
}

describe('a component may not do money arithmetic', () => {
  it('rejects the safe-daily-limit formula in a feature component', async () => {
    expect(await rulesFor('src/features/__arch_a/components/SafeDaily.tsx')).toContain(
      'no-restricted-syntax',
    )
  })

  it('rejects it in a shared component too', async () => {
    expect(await rulesFor('src/components/__arch/PerDay.tsx')).toContain('no-restricted-syntax')
  })

  it('allows the same arithmetic inside domain/, which is where it belongs', async () => {
    expect(await rulesFor('src/domain/__arch/calculate.ts')).not.toContain('no-restricted-syntax')
  })
})

describe('only data/ knows Supabase exists', () => {
  it('rejects the Supabase client in a feature hook', async () => {
    expect(await rulesFor('src/features/__arch_a/hooks/useRows.ts')).toContain(
      'no-restricted-imports',
    )
  })

  it('rejects the Supabase SDK in a shared component', async () => {
    expect(await rulesFor('src/components/__arch/Client.tsx')).toContain('no-restricted-imports')
  })

  it('rejects @capacitor/* in a feature (ARCHITECTURE.md §M.1)', async () => {
    expect(await rulesFor('src/features/__arch_a/hooks/useNative.ts')).toContain(
      'no-restricted-imports',
    )
  })
})

describe('domain/ is pure and has no clock', () => {
  it('rejects a React import', async () => {
    expect(await rulesFor('src/domain/__arch/impure.ts')).toContain('no-restricted-imports')
  })

  it('rejects new Date() and Date.now()', async () => {
    expect(await rulesFor('src/domain/__arch/clock.ts')).toEqual(
      expect.arrayContaining(['no-restricted-syntax', 'no-restricted-globals']),
    )
  })

  it('rejects Math.random(), because a calculation must be reproducible', async () => {
    expect(await rulesFor('src/domain/__arch/random.ts')).toContain('no-restricted-syntax')
  })

  it('rejects domain/ reaching up into data/', async () => {
    const rules = await rulesFor('src/domain/__arch/reachesUp.ts')

    expect(
      rules.some((rule) => rule.startsWith('boundaries/') || rule === 'no-restricted-imports'),
    ).toBe(true)
  })
})

describe('import.meta.env exists in exactly one file', () => {
  it('rejects it in a feature', async () => {
    expect(await rulesFor('src/features/__arch_a/hooks/useEnv.ts')).toContain(
      'no-restricted-syntax',
    )
  })
})

describe('layers point downward only', () => {
  it('rejects a shared component importing a feature', async () => {
    expect(await rulesFor('src/components/__arch/Reaches.ts')).toContain('boundaries/dependencies')
  })

  it('rejects one feature importing another', async () => {
    expect(await rulesFor('src/features/__arch_a/hooks/useOther.ts')).toContain(
      'boundaries/dependencies',
    )
  })
})

describe('console logging is banned in src/ (SECURITY.md §8.3)', () => {
  it('rejects console.log', async () => {
    expect(await rulesFor('src/features/__arch_a/hooks/useLog.ts')).toContain('no-console')
  })
})
