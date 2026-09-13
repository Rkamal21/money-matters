import { add, compare, isPositive, max, ratio, subtract, type Money, zero } from '../money/Money'

import type { CategoryTotal } from './PeriodSummary'

export interface CategoryShare {
  readonly categoryId: string
  readonly name: string
  readonly icon: string
  readonly color: string
  /** Spending net of refunds, never below zero. */
  readonly net: Money
  /** 0..1 of the total shown. Display only. */
  readonly share: number
}

/**
 * Where the money went, largest first — FINANCIAL-ENGINE.md §7.
 *
 * Refunds are netted per category (ADR-0018), categories that net to nothing
 * are dropped, and beyond `top` the tail is folded into one "Everything else"
 * slice so a donut stays legible on a 360 px screen.
 */
export function aggregateByCategory(input: {
  readonly totals: readonly CategoryTotal[]
  readonly currency: string
  readonly top?: number
}): { readonly total: Money; readonly slices: readonly CategoryShare[] } {
  const nothing = zero(input.currency)

  const spending = input.totals
    .filter((row) => row.kind === 'expense' && row.treatment !== 'excluded')
    .map((row) => ({ row, net: max(nothing, subtract(row.expense, row.refund)) }))
    .filter(({ net }) => isPositive(net))
    .sort((a, b) => compare(b.net, a.net) || a.row.name.localeCompare(b.row.name))

  const total = spending.reduce((sum, { net }) => add(sum, net), nothing)
  const limit = input.top ?? Number.POSITIVE_INFINITY

  const shown = spending.slice(0, limit)
  const rest = spending.slice(limit)

  const slices: CategoryShare[] = shown.map(({ row, net }) => ({
    categoryId: row.categoryId,
    name: row.name,
    icon: row.icon,
    color: row.color,
    net,
    share: ratio(net, total) ?? 0,
  }))

  if (rest.length > 0) {
    const restTotal = rest.reduce((sum, { net }) => add(sum, net), nothing)
    slices.push({
      categoryId: '__rest__',
      name: 'Everything else',
      icon: 'ellipsis',
      color: 'neutral',
      net: restTotal,
      share: ratio(restTotal, total) ?? 0,
    })
  }

  return { total, slices }
}
