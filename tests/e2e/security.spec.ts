import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { DEMO, signIn } from './helpers'

/** TESTING.md §6.3 — negative and security journeys. */

test('a signed-out visitor is sent to sign in, keeping where they were going', async ({ page }) => {
  await page.goto('/budget?period=2026-09-01')
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fbudget%3Fperiod%3D2026-09-01/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
})

test('a goal that is missing — or someone else’s — is simply "not available"', async ({ page }) => {
  await signIn(page, DEMO.email, DEMO.password)
  await page.goto(`/goals/${randomUUID()}`)
  await expect(page.getByRole('heading', { name: 'This goal is not available' })).toBeVisible()
})

test('a transaction that is not yours is "not available", not an error', async ({ page }) => {
  await signIn(page, DEMO.email, DEMO.password)
  await page.goto(`/transactions/${randomUUID()}/edit`)
  await expect(page.getByText('This transaction is not available')).toBeVisible()
})

test('after signing out, the back button shows no cached money', async ({ page }) => {
  await signIn(page, DEMO.email, DEMO.password)
  await page.goto('/dashboard')
  await expect(page.getByRole('region', { name: 'Balances' })).toContainText('₹')
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goBack()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('region', { name: 'Balances' })).toHaveCount(0)
})

test('the shipped JavaScript carries no service_role key (SECURITY.md §8.3)', async ({ page }) => {
  const scripts: string[] = []
  page.on('response', async (response) => {
    if (response.url().endsWith('.js')) scripts.push(await response.text())
  })
  await page.goto('/login')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // Patterns for an actual key, not the words: supabase-js itself checks for
  // the `sb_secret_` prefix in order to refuse such a key in a browser.
  for (const source of scripts) {
    expect(source).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/)
    for (const token of source.match(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
    ) ?? []) {
      const claims = Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()
      expect(claims).not.toMatch(/"role"\s*:\s*"service_role"/)
    }
  }
})
