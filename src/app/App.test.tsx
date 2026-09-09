import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

/**
 * The Milestone 0 component test. It proves the RTL harness end to end: JSX
 * compiles, jsdom renders, the Tailwind-classed tree mounts, and the queries
 * used throughout the rest of the project work.
 *
 * Queries are by role and accessible name on purpose (TESTING.md §5): a test
 * that passes is then evidence the markup is reachable by a screen reader, not
 * just that a div exists.
 */
describe('App', () => {
  it('renders a single top-level heading naming the product', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'Money Matters' })).toBeInTheDocument()
  })

  it('exposes the shell as a main landmark', () => {
    render(<App />)

    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('labels the status region by its own heading', () => {
    render(<App />)

    expect(screen.getByRole('region', { name: 'Foundation ready' })).toBeInTheDocument()
  })
})
