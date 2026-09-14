import { expect, test } from '@playwright/test'

import { createUser, deleteUser, openAddTransaction, signIn, TEST_PASSWORD } from './helpers'

/**
 * The critical journey — TESTING.md §6.1, the product's spine, in a real
 * browser against a real local Supabase.
 *
 *   sign in → onboarding (income, start day, account, savings goal, fixed costs)
 *     → add an expense (category auto-suggested) → move money into the goal
 *     → the dashboard: the transfer is neither income nor spending,
 *       spending is ₹450 (not ₹5,450), the safe daily limit is a real number
 *     → reload: every number is identical
 */
test('the critical journey', async ({ page }) => {
  test.setTimeout(120_000)
  const user = await createUser('journey')

  try {
    await signIn(page, user.email, TEST_PASSWORD)
    await expect(page).toHaveURL(/\/onboarding/)

    // 1. Money basics
    await page.getByLabel('Monthly take-home income').fill('60000')
    await page.getByLabel('Your month starts on day').selectOption('1')
    await page.getByRole('button', { name: 'Continue' }).click()

    // 2. First account
    await expect(page.getByRole('heading', { name: 'Where does your money sit?' })).toBeVisible()
    await page.getByLabel('Name', { exact: true }).fill('HDFC Bank')
    await page.getByLabel('Balance today').fill('50000')
    await page.getByRole('button', { name: 'Continue' }).click()

    // 3. Savings and a first goal
    await expect(page.getByRole('heading', { name: 'Pay yourself first' })).toBeVisible()
    await page.getByLabel('Monthly savings target').fill('10000')
    await page.getByLabel('What are you saving for?').fill('New Laptop')
    await page.getByLabel('Target', { exact: true }).fill('50000')
    await page.getByRole('button', { name: 'Continue' }).click()

    // 4. Fixed costs
    await expect(page.getByRole('heading', { name: 'Your fixed costs' })).toBeVisible()
    await page.getByLabel('Roughly how much are they each month?').fill('25000')
    await page.getByRole('button', { name: 'Finish' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    const hero = page.getByRole('region', { name: 'Safe to spend today' })
    await expect(hero).toContainText('/ day')

    // An expense, with the category suggested from what was typed.
    await openAddTransaction(page)
    const dialog = page.getByRole('dialog', { name: 'Add transaction' })
    await dialog.getByLabel('Amount').fill('450')
    await dialog.getByLabel('What was it?').fill('Swiggy dinner')
    await expect(dialog.getByText('Swiggy →')).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'Food' })).toBeChecked()
    await dialog.getByRole('button', { name: 'Save expense' }).click()
    await expect(dialog).toBeHidden()

    // Money into the goal: a transfer into its wallet.
    await page.goto('/goals')
    await page.getByRole('link', { name: /New Laptop/ }).click()
    await page.getByRole('button', { name: 'Add money' }).click()
    const move = page.getByRole('dialog', { name: /Add money to New Laptop/ })
    await move.getByLabel('Amount').fill('5000')
    await move.getByRole('button', { name: 'Add money' }).click()
    await expect(move).toBeHidden()
    await expect(page.getByRole('progressbar', { name: '10% of the target saved' })).toBeVisible()

    // The dashboard tells the truth about both.
    await page.goto('/dashboard')
    const period = page.getByRole('region', { name: 'This period' })
    await expect(period).toContainText('₹450')
    await expect(period).not.toContainText('₹5,450')
    // Text content includes each amount's spoken form for screen readers, hence the gap.
    await expect(period).toContainText(/₹5,000.*moved between your own accounts/)
    await expect(page.getByRole('region', { name: 'Goals' })).toContainText('New Laptop')

    // Nothing lived only in memory: after a reload every visible number is the same.
    const limitBefore = await hero.innerText()
    await page.reload()
    await expect(page.getByRole('region', { name: 'This period' })).toContainText('₹450')
    await expect
      .poll(() => page.getByRole('region', { name: 'Safe to spend today' }).innerText())
      .toBe(limitBefore)
  } finally {
    await deleteUser(user.id)
  }
})

test('double-tapping save creates one transaction', async ({ page }) => {
  test.setTimeout(90_000)
  const user = await createUser('double-tap')
  try {
    // Skip onboarding with a ready-made account and profile.
    await user.client.from('accounts').insert({ user_id: user.id, name: 'Cash', type: 'cash' })
    await user.client
      .from('profiles')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('id', user.id)

    await signIn(page, user.email, TEST_PASSWORD)
    await openAddTransaction(page)
    const dialog = page.getByRole('dialog', { name: 'Add transaction' })
    await dialog.getByLabel('Amount').fill('99')
    // The radio is visually hidden inside its tile; a person taps the tile.
    await dialog
      .locator('label')
      .filter({ hasText: /^Other$/ })
      .click()
    await expect(dialog.getByRole('radio', { name: 'Other' })).toBeChecked()
    // Two clicks in quick succession on the same button: the second must not
    // create a second row (the button disables in flight, and the request id
    // is idempotent even if it did not).
    await dialog.getByRole('button', { name: 'Save expense' }).dblclick()
    await expect(dialog).toBeHidden()

    const { count } = await user.client
      .from('transactions')
      .select('id', { count: 'exact', head: true })
    expect(count).toBe(1)
  } finally {
    await deleteUser(user.id)
  }
})
