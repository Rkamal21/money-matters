import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { DEMO, signIn } from './helpers'

/**
 * The Wallet screen from the reference design, against the seeded demo user:
 * every wallet as a card, one opened, its goal shown beside it — not merged.
 */
test('the wallets page lists each wallet and opens one', async ({ page }) => {
  await signIn(page, DEMO.email, DEMO.password)
  await page.goto('/wallets')
  await expect(page.getByRole('heading', { level: 1, name: 'Wallets' })).toBeVisible()

  const card = page.getByRole('link', { name: /Laptop fund/ }).first()
  await expect(card).toBeVisible()
  await expect(page.getByRole('region', { name: 'Savings' })).toContainText('New laptop')

  await card.click()
  await expect(page).toHaveURL(/\/wallets\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Laptop fund' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Balance' })).toContainText('₹')
  await expect(page.getByRole('link', { name: 'Open goal' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Activity' })).toBeVisible()
})

test('a wallet that is missing — or someone else’s — is simply "not available"', async ({
  page,
}) => {
  await signIn(page, DEMO.email, DEMO.password)
  await page.goto(`/wallets/${randomUUID()}`)
  await expect(page.getByRole('heading', { name: 'This wallet is not available' })).toBeVisible()
})
