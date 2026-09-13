import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

import { DEMO, signIn } from './helpers'

/**
 * TESTING.md §7: axe over the key routes. A new violation fails the build.
 * The CI a11y job selects these by the word "accessibility" in their names.
 */

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([])
}

test.describe('accessibility — public pages', () => {
  for (const [path, heading] of [
    ['/login', 'Welcome back'],
    ['/signup', 'Create your account'],
    ['/reset-password', 'Reset your password'],
  ] as const) {
    test(`${path} has no detectable accessibility violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await expectNoViolations(page)
    })
  }
})

test.describe('accessibility — signed-in pages', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEMO.email, DEMO.password)
  })

  for (const [path, heading] of [
    ['/dashboard', /^Good (morning|afternoon|evening)/],
    ['/transactions', 'Activity'],
    ['/budget', 'Budget'],
    ['/wallets', 'Wallets'],
    ['/goals', 'Goals'],
    ['/insights', 'Insights'],
    ['/progress', 'Progress'],
    ['/settings', 'Settings'],
    ['/settings/categories', 'Categories'],
  ] as const) {
    test(`${path} has no detectable accessibility violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      // Let the lazy data settle so axe sees the loaded state, not the skeleton.
      await expect(page.getByRole('status', { name: /Loading/ })).toHaveCount(0, {
        timeout: 15_000,
      })
      await expectNoViolations(page)
    })
  }

  test('the add-transaction sheet has no detectable accessibility violations', async ({ page }) => {
    await page.goto('/transactions/new')
    await expect(page.getByRole('dialog', { name: 'Add transaction' })).toBeVisible()
    await expectNoViolations(page)
  })
})
