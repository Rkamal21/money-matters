import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

/**
 * The composition root, rendered whole. With no stored session the auth
 * provider resolves to "signed out" without a network call, the guard sends
 * the visitor to sign-in, and the lazily loaded page renders — which proves
 * providers, router, guards and code splitting work together.
 *
 * Queries are by role and accessible name (TESTING.md §5).
 */
describe('App', () => {
  it('sends a signed-out visitor to sign in', async () => {
    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Welcome back' }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
  })

  it('stays on the sign-in page — no redirect loop through the sheet routes', async () => {
    window.history.replaceState(null, '', '/login')
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Welcome back' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(window.location.search).not.toContain('returnTo=%2Flogin')
  })

  it('offers the way to create an account and to recover a password', async () => {
    render(<App />)

    expect(await screen.findByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup',
    )
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/reset-password',
    )
  })

  it('labels every field of the sign-in form', async () => {
    render(<App />)

    expect(await screen.findByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })
})
