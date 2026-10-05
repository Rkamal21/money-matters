/**
 * JSON for values the app keeps on the device — the persisted query cache and
 * the offline outbox. Plain JSON loses two things this app holds in memory:
 * `bigint` (every `Money` is minor units as a bigint, ADR-0005), which
 * `JSON.stringify` refuses outright, and `Map`, which it writes as `{}`. Both
 * are written as tagged objects and read back as themselves.
 */

const TAG = '__mm'

type Tagged =
  | { readonly [TAG]: 'bigint'; readonly v: string }
  | { readonly [TAG]: 'map'; readonly v: readonly (readonly [unknown, unknown])[] }

export function toStoredJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === 'bigint') return { [TAG]: 'bigint', v: current.toString() }
    if (current instanceof Map) return { [TAG]: 'map', v: [...current.entries()] }
    return current
  })
}

export function fromStoredJson(text: string): unknown {
  return JSON.parse(text, (_key, current: unknown) => {
    if (typeof current !== 'object' || current === null || !(TAG in current)) return current
    const tagged = current as Tagged
    if (tagged[TAG] === 'bigint') return BigInt(tagged.v)
    if (tagged[TAG] === 'map') return new Map(tagged.v)
    return current
  })
}
