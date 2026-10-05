import { describe, expect, it } from 'vitest'

import { fromMinor } from '@/domain/money/Money'

import { fromStoredJson, toStoredJson } from './storedJson'

const roundTrip = (value: unknown) => fromStoredJson(toStoredJson(value))

describe('storedJson', () => {
  it('keeps Money as minor units in a bigint, not a number or a string', () => {
    const restored = roundTrip({ amount: fromMinor(123_456n, 'INR') }) as {
      amount: { minor: unknown; currency: string }
    }
    expect(restored.amount.minor).toBe(123_456n)
    expect(restored.amount.currency).toBe('INR')
  })

  it('keeps the largest amount the ledger allows exactly', () => {
    expect(roundTrip(900_000_000_000_000n)).toBe(900_000_000_000_000n)
    expect(roundTrip(-900_000_000_000_000n)).toBe(-900_000_000_000_000n)
  })

  it('keeps a Map as a Map, with its values restored too', () => {
    const restored = roundTrip({ limits: new Map([['food', 500n]]) }) as {
      limits: Map<string, bigint>
    }
    expect(restored.limits).toBeInstanceOf(Map)
    expect(restored.limits.get('food')).toBe(500n)
  })

  it('leaves ordinary JSON exactly as JSON would', () => {
    const value = { a: 1, b: 'x', c: [true, null], d: { e: 'f' } }
    expect(roundTrip(value)).toEqual(value)
  })
})
