/**
 * Financial health score — FINANCIAL-ENGINE.md §8.
 *
 * Each component is a 0..1 score or `null` for "not enough data". A `null`
 * component is left out and the remaining weights are renormalised, so a user
 * with no goals does not score zero on a dimension that does not apply to
 * them. The result returns its components, because a score without a next
 * action is decoration.
 */

export type HealthComponentKey =
  'savingsRate' | 'budgetAdherence' | 'trackingConsistency' | 'goalProgress' | 'spendingVolatility'

/** Product-owned weights, summing to 100. */
export const HEALTH_WEIGHTS: Readonly<Record<HealthComponentKey, number>> = {
  savingsRate: 30,
  budgetAdherence: 25,
  trackingConsistency: 20,
  goalProgress: 15,
  spendingVolatility: 10,
}

const LABELS: Readonly<Record<HealthComponentKey, string>> = {
  savingsRate: 'Savings rate',
  budgetAdherence: 'Staying within budgets',
  trackingConsistency: 'Tracking consistency',
  goalProgress: 'Goal progress',
  spendingVolatility: 'Steady spending',
}

const ADVICE: Readonly<Record<HealthComponentKey, string>> = {
  savingsRate: 'Aim to keep at least a fifth of your income.',
  budgetAdherence: 'Keep each category inside its limit.',
  trackingConsistency: 'Log spending on more days of the month.',
  goalProgress: 'Move money into your goals regularly.',
  spendingVolatility: 'Smooth out big swings between weeks.',
}

export type HealthBand = 'needs_attention' | 'fair' | 'good' | 'strong'

export interface HealthComponent {
  readonly key: HealthComponentKey
  readonly label: string
  /** 0..100 */
  readonly score: number
  /** Effective weight after renormalisation, 0..100. */
  readonly weight: number
  readonly explanation: string
}

export type HealthScoreResult =
  | {
      readonly status: 'ok'
      readonly score: number
      readonly band: HealthBand
      readonly components: readonly HealthComponent[]
      readonly weakest: HealthComponent
    }
  | { readonly status: 'insufficient_data' }

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** A 20% savings rate earns the full component; negative savings earn nothing. */
export function scoreSavingsRate(rate: number | null): number | null {
  return rate === null ? null : clamp01(rate / 0.2)
}

/** Share of budgeted categories inside their limit. */
export function scoreBudgetAdherence(within: number, budgeted: number): number | null {
  return budgeted === 0 ? null : clamp01(within / budgeted)
}

/** Days with at least one transaction in the last 30; 15 or more earns the full component. */
export function scoreTrackingConsistency(activeDays: number): number | null {
  return clamp01(activeDays / 15)
}

/** Coefficient of variation of weekly spend: 0 is perfectly steady, ≥ 1 scores nothing. */
export function scoreVolatility(weeklyTotals: readonly number[]): number | null {
  if (weeklyTotals.length < 3) return null
  const mean = weeklyTotals.reduce((sum, value) => sum + value, 0) / weeklyTotals.length
  if (mean === 0) return null
  const variance =
    weeklyTotals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / weeklyTotals.length
  return clamp01(1 - Math.sqrt(variance) / mean)
}

function band(score: number): HealthBand {
  if (score < 40) return 'needs_attention'
  if (score < 60) return 'fair'
  if (score < 80) return 'good'
  return 'strong'
}

export function calculateFinancialHealthScore(
  input: Readonly<Record<HealthComponentKey, number | null>>,
): HealthScoreResult {
  const present = (Object.keys(HEALTH_WEIGHTS) as HealthComponentKey[]).filter(
    (key) => input[key] !== null,
  )
  if (present.length < 2) return { status: 'insufficient_data' }

  const totalWeight = present.reduce((sum, key) => sum + HEALTH_WEIGHTS[key], 0)

  const components: HealthComponent[] = present.map((key) => {
    const value = clamp01(input[key] ?? 0)
    return {
      key,
      label: LABELS[key],
      score: Math.round(value * 100),
      weight: Math.round((HEALTH_WEIGHTS[key] / totalWeight) * 1000) / 10,
      explanation: ADVICE[key],
    }
  })

  const score = Math.round(
    (present.reduce((sum, key) => sum + clamp01(input[key] ?? 0) * HEALTH_WEIGHTS[key], 0) /
      totalWeight) *
      100,
  )

  const weakest = components.reduce((low, component) =>
    component.score * component.weight < low.score * low.weight ? component : low,
  )

  return { status: 'ok', score, band: band(score), components, weakest }
}
