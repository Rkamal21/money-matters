import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * The Milestone 0 end-to-end spec.
 *
 * It proves the harness rather than a journey, because there is no journey yet:
 * the app builds, the bundle boots in a real browser at a real mobile viewport,
 * the entry point mounts, configuration validated without throwing, and the
 * axe pass runs. The critical journey (TESTING.md §6.1) lands in M1 when there
 * is something to sign into.
 */
test.describe('foundation shell', () => {
  test('boots and renders the shell', async ({ page }) => {
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))

    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1, name: 'Money Matters' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Foundation ready' })).toBeVisible()

    // A configuration error throws at module load, so a blank screen with a
    // clean console is the failure mode this catches.
    expect(failures).toEqual([])
  })

  test('has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })

  test('ships no service_role key in the bundle (SECURITY.md §8.3)', async ({ page }) => {
    const scripts: string[] = []
    page.on('response', async (response) => {
      if (response.url().endsWith('.js')) scripts.push(await response.text())
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    for (const source of scripts) {
      expect(source).not.toContain('service_role')
      expect(source).not.toContain('sb_secret_')
    }
  })
})
