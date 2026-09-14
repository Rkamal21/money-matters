import { allocate, compare, subtract, sumAll, type Money } from '../money/Money'

/**
 * Split arithmetic for the entry form. The database is the authority — its
 * deferred constraint checks the parts sum to the whole at commit
 * (DATABASE.md §6.5) — these only let the form say so before submitting.
 */

/** What is left to assign: positive when under, negative when over. */
export function splitRemainder(total: Money, parts: readonly Money[]): Money {
  return subtract(total, sumAll(parts, total.currency))
}

export function splitStatus(total: Money, parts: readonly Money[]): 'balanced' | 'under' | 'over' {
  const sign = compare(sumAll(parts, total.currency), total)
  return sign === 0 ? 'balanced' : sign < 0 ? 'under' : 'over'
}

/** `n` equal parts that sum exactly to the total, the leftover paise going to the first parts. */
export function evenSplit(total: Money, n: number): Money[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('A split needs at least one part.')
  return allocate(
    total,
    Array.from({ length: n }, () => 1n),
  )
}
