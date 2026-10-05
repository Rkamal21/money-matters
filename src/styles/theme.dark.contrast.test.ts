import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The dark palette is held to the same thresholds as the light one
 * (ARCHITECTURE.md §F.6), parsed from the stylesheet itself so a nudged hex
 * value fails here rather than in an audit.
 *
 * It is also checked to be identical in its two copies — the explicit
 * `[data-theme='dark']` block and the `prefers-color-scheme` block — because
 * two copies that drift apart are two different dark themes.
 */

const CSS = readFileSync(join(import.meta.dirname, 'theme.css'), 'utf8')

function block(selector: string): string {
  const start = CSS.indexOf(selector)
  if (start === -1) throw new Error(`${selector} is missing from theme.css`)
  return CSS.slice(start, CSS.indexOf('}', start))
}

const EXPLICIT = block(":root[data-theme='dark'] {")
const SYSTEM = block(":root:not([data-theme='light']) {")

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
  if (!match?.[1]) throw new Error(`--color-${name} is missing from the dark palette`)
  return match[1].toLowerCase()
}

const dark = (name: string) => token(EXPLICIT, name)

describe('dark palette contrast (ARCHITECTURE.md §F.6)', () => {
  it.each(
    ['text', 'text-muted', 'brand', 'positive', 'caution', 'negative'].flatMap((t) =>
      ['bg', 'surface'].map((bg) => [t, bg] as const),
    ),
  )('--color-%s on --color-%s is at least 4.5:1', (name, background) => {
    expect(contrast(dark(name), dark(background))).toBeGreaterThanOrEqual(4.5)
  })

  it.each([['focus'], ['border-strong']] as const)(
    '--color-%s clears 3:1 on both backgrounds',
    (name) => {
      expect(contrast(dark(name), dark('bg'))).toBeGreaterThanOrEqual(3)
      expect(contrast(dark(name), dark('surface'))).toBeGreaterThanOrEqual(3)
    },
  )

  it('white on the filled button colours clears 4.5:1, in both palettes', () => {
    for (const source of [CSS, EXPLICIT]) {
      expect(
        contrast(token(source, 'on-brand'), token(source, 'brand-strong')),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(token(source, 'on-brand'), token(source, 'negative-strong')),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('still separates positive from negative by lightness', () => {
    expect(contrast(dark('positive'), dark('negative'))).toBeGreaterThanOrEqual(1.5)
  })

  it('keeps `border` decorative, as in the light palette', () => {
    expect(contrast(dark('border'), dark('surface'))).toBeLessThan(3)
  })

  it('has identical values in the explicit and the system-preference blocks', () => {
    const values = (source: string) =>
      [...source.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => `${m[1]}=${m[2]}`)
    expect(values(SYSTEM)).toEqual(values(EXPLICIT))
  })

  it('defines every category colour in both palettes', () => {
    for (const name of [
      'orange',
      'blue',
      'pink',
      'slate',
      'purple',
      'red',
      'teal',
      'sky',
      'amber',
      'green',
      'emerald',
      'neutral',
    ]) {
      expect(() => token(CSS, `cat-${name}`)).not.toThrow()
      expect(() => dark(`cat-${name}`)).not.toThrow()
    }
  })
})
