import { expect, test } from '@playwright/test'

import { createUser, deleteUser, openAddTransaction, signIn, TEST_PASSWORD } from './helpers'

/**
 * TESTING.md §6.2: "Offline: submit a transaction with the network cut →
 * queued, retried, saved once (not twice)" — ARCHITECTURE.md §M.2's outbox.
 */
test('a transaction saved offline is added once when the connection is back', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000)
  const user = await createUser('offline')
  try {
    await user.client.from('accounts').insert({ user_id: user.id, name: 'Cash', type: 'cash' })
    await user.client
      .from('profiles')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('id', user.id)

    await signIn(page, user.email, TEST_PASSWORD)
    await expect(page.getByRole('region', { name: 'Safe to spend today' })).toBeVisible()

    // Load the entry sheet once while online: its code is a lazy chunk, and the
    // app is not offline-first for code it has never downloaded.
    await openAddTransaction(page)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Add transaction' })).toBeHidden()

    await context.setOffline(true)
    await expect(page.getByRole('status').filter({ hasText: 'You are offline.' })).toBeVisible()

    await openAddTransaction(page)
    const dialog = page.getByRole('dialog', { name: 'Add transaction' })
    await dialog.getByLabel('Amount').fill('120')
    await dialog.getByLabel('What was it?').fill('Chai and samosa')
    await dialog
      .locator('label')
      .filter({ hasText: /^Other$/ })
      .click()
    await dialog.getByRole('button', { name: 'Save expense' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
    await expect(page.getByText('1 transaction saved on this device')).toBeVisible()

    const before = await user.client
      .from('transactions')
      .select('id', { count: 'exact', head: true })
    expect(before.count).toBe(0)

    await context.setOffline(false)
    await expect(page.getByText('Added the transaction you saved offline')).toBeVisible()
    await expect(page.getByText('1 transaction saved on this device')).toBeHidden()

    const after = await user.client.from('transactions').select('description', { count: 'exact' })
    expect(after.count).toBe(1)
    expect(after.data?.[0]?.description).toBe('Chai and samosa')
  } finally {
    await deleteUser(user.id)
  }
})
