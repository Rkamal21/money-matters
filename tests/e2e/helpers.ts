import { expect, type Page } from '@playwright/test'

/**
 * E2E helpers. Users are created confirmed through the local admin API
 * (tests/integration/clients.ts), so each spec gets its own, isolated user
 * and specs stay independent and parallelisable (TESTING.md §6).
 */
export { createUser, deleteUser, TEST_PASSWORD } from '../integration/clients'

/** The seeded demo user (supabase/seed.sql) — local only. */
export const DEMO = { email: 'demo@moneymatters.local', password: 'demo-password-123' } as const

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** The add button exists twice (tab bar on phones, sidebar on desktop); use whichever is visible. */
export async function openAddTransaction(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Add transaction' }).locator('visible=true').first().click()
  await expect(page.getByRole('dialog', { name: 'Add transaction' })).toBeVisible()
}
