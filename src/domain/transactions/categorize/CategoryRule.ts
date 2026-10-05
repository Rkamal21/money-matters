import { normalizeMerchant } from './normalizeMerchant'

/**
 * Rule-based categorisation — API.md §2.10, DATABASE.md §6.10.
 *
 * The pipeline: normalise → match → suggest → confirm → learn. This module is
 * the match step and the provider interface; it is importable and testable
 * with zero React (ROADMAP.md M3).
 */

export type MatchType = 'contains' | 'prefix' | 'exact'

export interface CategoryRule {
  readonly id: string
  /** `null` is a system rule; otherwise the user's own override. */
  readonly userId: string | null
  /** Lower-case, already normalised. */
  readonly pattern: string
  readonly matchType: MatchType
  readonly merchantLabel: string
  readonly categorySlug: string
  /** 0..1 */
  readonly confidence: number
  /** Lower wins. User rules are written at 10, system rules at 100. */
  readonly priority: number
  readonly isEnabled: boolean
}

export interface CategorySuggestion {
  readonly categorySlug: string
  readonly merchantLabel: string
  readonly confidence: number
  readonly ruleId: string
  readonly source: 'user' | 'system'
  /** The rule's pattern: what a correction learns from. */
  readonly pattern: string
  readonly matchType: MatchType
}

export interface CategorizationProvider {
  readonly id: string
  suggest(input: {
    readonly merchantRaw: string
    readonly description?: string
  }): Promise<CategorySuggestion | null>
}

/** At or above this, the form pre-fills the category; below it, it asks. */
export const AUTO_APPLY_CONFIDENCE = 0.9

const SPECIFICITY: Readonly<Record<MatchType, number>> = { exact: 3, prefix: 2, contains: 1 }

/**
 * `exact` matches a whole word — "ola" matches "upi ola 12" but not
 * "granola" — because a bank string is rarely the merchant name alone.
 * `prefix` matches the start of the text; `contains` anywhere.
 */
export function ruleMatches(
  rule: Pick<CategoryRule, 'pattern' | 'matchType'>,
  text: string,
): boolean {
  if (text === '') return false
  switch (rule.matchType) {
    case 'contains':
      return text.includes(rule.pattern)
    case 'prefix':
      return text.startsWith(rule.pattern)
    case 'exact':
      return text === rule.pattern || ` ${text} `.includes(` ${rule.pattern} `)
  }
}

/**
 * Precedence: enabled rules only; lower priority number first (so a user rule
 * beats a system rule); then the more specific match type; then the longer
 * pattern. First match wins. No match returns `null` — never a guessed
 * "Other" (TESTING.md §3.4).
 */
export function orderRules(rules: readonly CategoryRule[]): CategoryRule[] {
  return rules
    .filter((rule) => rule.isEnabled)
    .slice()
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        SPECIFICITY[b.matchType] - SPECIFICITY[a.matchType] ||
        b.pattern.length - a.pattern.length ||
        a.pattern.localeCompare(b.pattern),
    )
}

export function matchRules(
  rules: readonly CategoryRule[],
  merchantRaw: string,
): CategorySuggestion | null {
  const text = normalizeMerchant(merchantRaw)
  if (text === '') return null

  const rule = orderRules(rules).find((candidate) => ruleMatches(candidate, text))
  if (rule === undefined) return null

  return {
    categorySlug: rule.categorySlug,
    merchantLabel: rule.merchantLabel,
    confidence: rule.confidence,
    ruleId: rule.id,
    source: rule.userId === null ? 'system' : 'user',
    pattern: rule.pattern,
    matchType: rule.matchType,
  }
}

/** The MVP provider: the rules above, in memory. */
export class RuleBasedProvider implements CategorizationProvider {
  readonly id = 'rules'
  private readonly ordered: readonly CategoryRule[]

  constructor(rules: readonly CategoryRule[]) {
    this.ordered = orderRules(rules)
  }

  suggest(input: {
    readonly merchantRaw: string
    readonly description?: string
  }): Promise<CategorySuggestion | null> {
    const fromMerchant = matchRules(this.ordered, input.merchantRaw)
    if (fromMerchant !== null || input.description === undefined) {
      return Promise.resolve(fromMerchant)
    }
    return Promise.resolve(matchRules(this.ordered, input.description))
  }
}

/**
 * The personal rule a correction writes (API.md §2.10 "learn"). It reuses the
 * pattern that produced the wrong suggestion, so the correction applies to
 * exactly the text that was miscategorised, and it outranks the system rule.
 */
export function learnedRule(input: {
  readonly suggestion: CategorySuggestion
  readonly correctedSlug: string
}): Pick<
  CategoryRule,
  'pattern' | 'matchType' | 'merchantLabel' | 'categorySlug' | 'confidence' | 'priority'
> | null {
  if (input.suggestion.categorySlug === input.correctedSlug) return null
  return {
    pattern: input.suggestion.pattern,
    matchType: input.suggestion.matchType,
    merchantLabel: input.suggestion.merchantLabel,
    categorySlug: input.correctedSlug,
    confidence: 0.95,
    priority: 10,
  }
}
