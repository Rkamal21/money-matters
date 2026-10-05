/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: supabase/seed.sql, between the DEFAULT CATEGORIES markers.
 * Regenerate: npm run gen:categories
 * Verified in CI: npm run gen:categories -- --check
 *
 * The SQL is authoritative (ARCHITECTURE.md §R.5, ADR-0023). Editing this file
 * by hand only means the next `--check` run fails.
 */

export interface DefaultCategory {
  readonly slug: string
  readonly name: string
  readonly kind: 'expense' | 'income'
  readonly treatment: 'fixed' | 'variable' | 'excluded'
  readonly icon: string
  readonly color: string
  readonly position: number
}

export const DEFAULT_CATEGORIES = [
  {
    slug: 'food',
    name: 'Food',
    kind: 'expense',
    treatment: 'variable',
    icon: 'utensils',
    color: 'orange',
    position: 1,
  },
  {
    slug: 'transport',
    name: 'Transport',
    kind: 'expense',
    treatment: 'variable',
    icon: 'car',
    color: 'blue',
    position: 2,
  },
  {
    slug: 'shopping',
    name: 'Shopping',
    kind: 'expense',
    treatment: 'variable',
    icon: 'shopping-bag',
    color: 'pink',
    position: 3,
  },
  {
    slug: 'bills',
    name: 'Bills',
    kind: 'expense',
    treatment: 'fixed',
    icon: 'receipt',
    color: 'slate',
    position: 4,
  },
  {
    slug: 'entertainment',
    name: 'Entertainment',
    kind: 'expense',
    treatment: 'variable',
    icon: 'clapperboard',
    color: 'purple',
    position: 5,
  },
  {
    slug: 'healthcare',
    name: 'Healthcare',
    kind: 'expense',
    treatment: 'variable',
    icon: 'heart-pulse',
    color: 'red',
    position: 6,
  },
  {
    slug: 'education',
    name: 'Education',
    kind: 'expense',
    treatment: 'variable',
    icon: 'graduation-cap',
    color: 'teal',
    position: 7,
  },
  {
    slug: 'travel',
    name: 'Travel',
    kind: 'expense',
    treatment: 'variable',
    icon: 'plane',
    color: 'sky',
    position: 8,
  },
  {
    slug: 'personal',
    name: 'Personal',
    kind: 'expense',
    treatment: 'variable',
    icon: 'user',
    color: 'amber',
    position: 9,
  },
  {
    slug: 'other',
    name: 'Other',
    kind: 'expense',
    treatment: 'variable',
    icon: 'circle',
    color: 'neutral',
    position: 10,
  },
  {
    slug: 'salary',
    name: 'Salary',
    kind: 'income',
    treatment: 'variable',
    icon: 'briefcase',
    color: 'green',
    position: 11,
  },
  {
    slug: 'other_income',
    name: 'Other Income',
    kind: 'income',
    treatment: 'variable',
    icon: 'circle-plus',
    color: 'emerald',
    position: 12,
  },
] as const satisfies readonly DefaultCategory[]

export type DefaultCategorySlug = (typeof DEFAULT_CATEGORIES)[number]['slug']

export const DEFAULT_CATEGORY_SLUGS: readonly DefaultCategorySlug[] = DEFAULT_CATEGORIES.map(
  (category) => category.slug,
)
