import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The two additions from the Financy reference design, held to the same
 * thresholds as the rest of the palette (ARCHITECTURE.md §F.6):
 *
 *   - identity colours, as progress fills and icon glyphs on a card (3:1);
 *   - the inverse surface — the dark hero card — and the token set that
 *     content on it uses (`.theme-inverse`), in both themes.
 */

const CSS = readFileSync(join(import.meta.dirname, 'theme.css'), 'utf8')

function block(selector: string): string {
  const start = CSS.indexOf(selector)
  if (start === -1) throw new Error(`${selector} is missing from theme.css`)
  return CSS.slice(start, CSS.indexOf('}', start))
}

const LIGHT = block('@theme {')
const DARK = block(":root[data-theme='dark'] {")
const INVERSE = block('.theme-inverse {')

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

function token(source: string, name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source)
  if (!match?.[1]) throw new Error(`--color-${name} is missing`)
  return match[1].toLowerCase()
}

const FILLS = ['blue', 'coral', 'teal', 'violet', 'gold', 'pink'] as const

describe('identity colours', () => {
  it.each(FILLS)('--color-id-%s clears 3:1 on a card, in both palettes', (name) => {
    expect(contrast(token(LIGHT, `id-${name}`), token(LIGHT, 'surface'))).toBeGreaterThanOrEqual(3)
    expect(contrast(token(DARK, `id-${name}`), token(DARK, 'surface'))).toBeGreaterThanOrEqual(3)
  })

  it('are documented as identity, never status', () => {
    expect(CSS).toMatch(/never signal financial status/)
  })
})

const TEXT = ['text', 'text-muted', 'brand', 'positive', 'caution', 'negative'] as const
const GROUNDS = [
  ['light-theme card', token(LIGHT, 'inverse')],
  ['dark-theme card', token(DARK, 'inverse')],
  ['inset panel', token(INVERSE, 'bg')],
] as const

describe('the inverse surface', () => {
  it.each(TEXT.flatMap((name) => GROUNDS.map(([label, ground]) => [name, label, ground] as const)))(
    '--color-%s on the %s is at least 4.5:1',
    (name, _label, ground) => {
      expect(contrast(token(INVERSE, name), ground)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(['focus', 'border-strong'] as const)('--color-%s clears 3:1 on every ground', (name) => {
    for (const [, ground] of GROUNDS) {
      expect(contrast(token(INVERSE, name), ground)).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps a filled button on it readable', () => {
    expect(
      contrast(token(INVERSE, 'on-brand'), token(INVERSE, 'brand-strong')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('still separates positive from negative by lightness', () => {
    expect(contrast(token(INVERSE, 'positive'), token(INVERSE, 'negative'))).toBeGreaterThan(1)
  })
})
