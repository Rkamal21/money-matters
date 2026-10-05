/**
 * Identity colours — the Financy reference's six hues (theme.css), used to
 * tell things apart at a glance: a wallet's tile, a goal's progress fill.
 *
 * Identity, never status: a coral goal is not "in trouble", and nothing here
 * is ever the only way something is identified — its name is always shown.
 * Nothing is stored either; the colour is derived from a stable key in the
 * UI, so no presentation metadata reaches the database.
 */
export const IDENTITIES = ['blue', 'coral', 'teal', 'violet', 'gold', 'pink'] as const
export type Identity = (typeof IDENTITIES)[number]

/** Literal class names, so Tailwind generates each one. */
const TILE: Readonly<Record<Identity, string>> = {
  blue: 'bg-id-blue/15 text-id-blue',
  coral: 'bg-id-coral/15 text-id-coral',
  teal: 'bg-id-teal/15 text-id-teal',
  violet: 'bg-id-violet/15 text-id-violet',
  gold: 'bg-id-gold/15 text-id-gold',
  pink: 'bg-id-pink/15 text-id-pink',
}

const FILL: Readonly<Record<Identity, string>> = {
  blue: 'bg-id-blue',
  coral: 'bg-id-coral',
  teal: 'bg-id-teal',
  violet: 'bg-id-violet',
  gold: 'bg-id-gold',
  pink: 'bg-id-pink',
}

const GLYPH: Readonly<Record<Identity, string>> = {
  blue: 'text-id-blue',
  coral: 'text-id-coral',
  teal: 'text-id-teal',
  violet: 'text-id-violet',
  gold: 'text-id-gold',
  pink: 'text-id-pink',
}

/** The nth identity, cycling — for lists whose order is stable. */
export function identityAt(index: number): Identity {
  return IDENTITIES[Math.abs(Math.trunc(index)) % IDENTITIES.length] ?? 'blue'
}

/** A stable identity for an id, so a wallet keeps its colour wherever it appears. */
export function identityOf(key: string): Identity {
  let hash = 0
  for (const char of key) hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) >>> 0
  return identityAt(hash)
}

/** A tinted tile with a coloured glyph. */
export function identityTile(identity: Identity): string {
  return TILE[identity]
}

/** A solid fill: progress bars and decorative shapes. */
export function identityFill(identity: Identity): string {
  return FILL[identity]
}

export function identityGlyph(identity: Identity): string {
  return GLYPH[identity]
}
