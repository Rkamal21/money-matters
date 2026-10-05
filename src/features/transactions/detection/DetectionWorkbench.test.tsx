import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import { ToastProvider } from '@/components/ui/Toast'
import { of } from '@/domain/period/LocalDate'
import {
  ACCOUNTS,
  CATEGORIES,
  candidateOf,
  MESSAGES,
  RULES,
  USER_ID,
} from '@tests/fixtures/detection'
import { TEST_SUPABASE_URL } from '@tests/setup/env'
import { server } from '@tests/setup/msw/server'

import { DetectionWorkbench } from './DetectionWorkbench'

const FILE = [MESSAGES.sbi, MESSAGES.airtel, MESSAGES.otp, MESSAGES.promo]

function renderWorkbench(loadLocalMessages: () => Promise<string[]> = () => Promise.resolve(FILE)) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <DetectionWorkbench
            userId={USER_ID}
            accounts={ACCOUNTS}
            categories={CATEGORIES}
            rules={RULES}
            today={of(2026, 10, 5)}
            currency="INR"
            locale="en-IN"
            loadLocalMessages={loadLocalMessages}
          />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const table = (caption: string) => screen.getByRole('table', { name: caption })
const rowsOf = (caption: string) => within(table(caption)).getAllByRole('row').slice(1)

let consoleSpies: MockInstance[] = []

beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method),
  )
})

afterEach(() => {
  // SECURITY.md §9: no message text in any console output, ever.
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) {
      const printed = call.map(String).join(' ')
      for (const message of [...FILE, MESSAGES.expense]) {
        expect(printed).not.toContain(message.slice(0, 30))
      }
    }
    spy.mockRestore()
  }
})

describe('DetectionWorkbench — the real message test runner', () => {
  it('runs every message in bank-messages.local and tabulates the results', async () => {
    const user = renderWorkbench()
    await user.click(screen.getByRole('button', { name: 'Load bank-messages.local' }))

    expect(
      await screen.findByRole('heading', { name: 'Results: 4 messages · 2 accepted · 2 rejected' }),
    ).toBeInTheDocument()

    const accepted = rowsOf('Accepted messages')
    expect(accepted).toHaveLength(2)
    const sbi = candidateOf(MESSAGES.sbi)
    expect(
      within(accepted[0] as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      '1',
      'Accepted',
      expect.stringContaining('250'),
      'expense',
      'Amit',
      '—',
      '90 (high)',
      `${sbi.fingerprint.value.slice(0, 12)}…`,
      'Inspect',
    ])
    expect(within(accepted[1] as HTMLElement).getAllByRole('cell')[3]).toHaveTextContent('income')

    const rejected = rowsOf('Rejected messages')
    expect(rejected.map((row) => within(row).getAllByRole('cell')[2]?.textContent)).toEqual([
      'OTP message (otp)',
      'Promotional message (promotional)',
    ])
  })

  it('shows the input and every parsed field for the message it inspects', async () => {
    const user = renderWorkbench()
    await user.click(screen.getByRole('button', { name: 'Load bank-messages.local' }))
    await user.click(await screen.findByRole('button', { name: 'Inspect message 1' }))

    expect(screen.getByRole('heading', { name: 'Message #1' })).toBeInTheDocument()
    expect(screen.getByLabelText('Original message')).toHaveTextContent(MESSAGES.sbi)
    const field = (label: string) =>
      screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
    expect(field('Result')).toBe('Accepted')
    expect(field('Currency')).toBe('INR')
    expect(field('Direction')).toBe('expense')
    expect(field('Transaction kind')).toBe('expense')
    expect(field('Reference')).toBe('900000000003')
    expect(field('Account last 4')).toBe('1234')
    expect(field('Date')).toBe('2026-10-02 (message)')
    expect(field('Confidence')).toBe('90/100')
    expect(field('Confidence level')).toBe('high')
    expect(field('Fingerprint')).toBe(`${candidateOf(MESSAGES.sbi).fingerprint.value} (reference)`)
    expect(screen.getByRole('button', { name: 'Review transaction' })).toBeInTheDocument()
  })

  it('offers no review for a rejected message, only its reason', async () => {
    const user = renderWorkbench()
    await user.click(screen.getByRole('button', { name: 'Load bank-messages.local' }))
    await user.click(await screen.findByRole('button', { name: 'Inspect message 3' }))

    expect(
      screen.getByText('Rejection reason', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('OTP message (otp)')
    expect(screen.queryByRole('button', { name: 'Review transaction' })).not.toBeInTheDocument()
  })

  it('parses a pasted message', async () => {
    const user = renderWorkbench()
    await user.type(screen.getByLabelText('Bank or UPI message'), MESSAGES.expense)
    await user.click(screen.getByRole('button', { name: 'Run parser' }))

    expect(
      screen.getByRole('heading', { name: 'Results: 1 message · 1 accepted · 0 rejected' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Original message')).toHaveTextContent(MESSAGES.expense)
  })

  it('records a rejection in the results without writing anything', async () => {
    let writes = 0
    server.use(
      http.get(`${TEST_SUPABASE_URL}/rest/v1/transactions`, () => HttpResponse.json([])),
      http.post(`${TEST_SUPABASE_URL}/rest/v1/transactions`, () => {
        writes += 1
        return HttpResponse.json({}, { status: 500 })
      }),
    )
    const user = renderWorkbench()
    await user.click(screen.getByRole('button', { name: 'Load bank-messages.local' }))
    await user.click(await screen.findByRole('button', { name: 'Review transaction' }))
    await user.click(screen.getByRole('button', { name: 'Reject' }))

    expect(screen.getByText('Rejected. Nothing was saved.')).toBeInTheDocument()
    expect(
      within(rowsOf('Accepted messages')[0] as HTMLElement).getAllByRole('cell')[1],
    ).toHaveTextContent('Rejected by you')
    expect(writes).toBe(0)
  })

  it('explains why the file could not be loaded', async () => {
    const user = renderWorkbench(() =>
      Promise.reject(new Error('bank-messages.local was not found in the project folder.')),
    )
    await user.click(screen.getByRole('button', { name: 'Load bank-messages.local' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'bank-messages.local was not found in the project folder.',
    )
  })

  it('Clear drops every message from the page', async () => {
    const user = renderWorkbench()
    await user.type(screen.getByLabelText('Bank or UPI message'), MESSAGES.expense)
    await user.click(screen.getByRole('button', { name: 'Run parser' }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByLabelText('Bank or UPI message')).toHaveValue('')
    expect(screen.queryByLabelText('Original message')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Results/ })).not.toBeInTheDocument()
  })
})
