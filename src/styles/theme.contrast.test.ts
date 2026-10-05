import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The palette is verified, not asserted.
 *
 * ARCHITECTURE.md §F.6: "Token pairs validated at ≥ 4.5:1 (text) / 3:1 (UI) at
 * design time." §F.5 specifies the token *names* and leaves the values as
 * `...`, so the concrete palette was chosen in Milestone 0 — which means the
 * claim that it is accessible is ours to prove rather than inherit.
 *
 * This test parses `theme.css` itself, so it fails when someone nudges a hex
 * value, not only when someone edits a table of numbers in a comment. The axe
 * pass in the E2E suite covers rendered pages; this covers the tokens before
 * any page uses them, which is the only point at which fixing one is cheap.
 */

const THEME_CSS = readFileSync(join(import.meta.dirname, 'theme.css'), 'utf8')

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

/** Read a `--color-*` token straight out of the stylesheet. */
function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(THEME_CSS)
  if (!match?.[1])
    throw new Error(`--color-${name} is missing from theme.css, or is not a 6-digit hex`)
  return match[1].toLowerCase()
}

const BACKGROUNDS = ['bg', 'surface'] as const

/** Tokens used to paint text. WCAG 1.4.3 at AA: 4.5:1. */
const TEXT_TOKENS = ['text', 'text-muted', 'brand', 'positive', 'caution', 'negative'] as const

/** Tokens that carry meaning as a boundary or indicator. WCAG 1.4.11: 3:1. */
const UI_TOKENS = ['focus', 'border-strong'] as const

describe('theme tokens meet the contrast thresholds in ARCHITECTURE.md §F.6', () => {
  it.each(TEXT_TOKENS.flatMap((t) => BACKGROUNDS.map((bg) => [t, bg] as const)))(
    '--color-%s on --color-%s is at least 4.5:1',
    (name, background) => {
      const ratio = contrast(token(name), token(background))

      expect(
        ratio,
        `--color-${name} on --color-${background} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(UI_TOKENS.flatMap((t) => BACKGROUNDS.map((bg) => [t, bg] as const)))(
    '--color-%s on --color-%s is at least 3:1',
    (name, background) => {
      const ratio = contrast(token(name), token(background))

      expect(
        ratio,
        `--color-${name} on --color-${background} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3)
    },
  )
})

describe('the palette holds the shape §F.5 describes', () => {
  it('defines every semantic role token', () => {
    for (const name of [
      'bg',
      'surface',
      'border',
      'border-strong',
      'text',
      'text-muted',
      'brand',
      'positive',
      'caution',
      'negative',
      'focus',
    ]) {
      expect(() => token(name)).not.toThrow()
    }
  })

  it('uses one accent: brand and focus are the same colour (§F.5 rule 1)', () => {
    expect(token('focus')).toBe(token('brand'))
  })

  it('separates positive from negative by lightness, not only by hue', () => {
    // The one status pair where hue alone is not enough: a red-green colour-blind
    // user separates "under budget" from "over budget" by lightness or not at
    // all. The first draft of this palette had them at 1.10:1 — the same swatch.
    expect(contrast(token('positive'), token('negative'))).toBeGreaterThanOrEqual(1.5)
  })

  it('accepts that caution and negative are close in lightness, and says why', () => {
    // Amber and red separated far enough in tone to pass a lightness test stop
    // reading as a scale. They are separated by hue, and §F.5 rule 3 carries the
    // rest: every status ships an icon and a word alongside the colour. Asserted
    // rather than omitted so the limitation cannot be forgotten, and so raising
    // the separation later is a deliberate edit to this test.
    expect(contrast(token('caution'), token('negative'))).toBeLessThan(1.5)
    expect(THEME_CSS).toMatch(/never by colour alone/)
  })

  it('documents `border` as decorative, because it does not meet the UI threshold', () => {
    // Deliberate, and load-bearing: if someone raises this to 3:1 the comment in
    // theme.css should go, and if someone uses it for an input outline the
    // comment is what tells them not to. Asserting the fact keeps the two in step.
    expect(contrast(token('border'), token('surface'))).toBeLessThan(3)
    expect(THEME_CSS).toMatch(/`border` is decorative/)
  })
})
