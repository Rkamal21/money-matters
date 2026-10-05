import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/components/ui/Toast'
import { of } from '@/domain/period/LocalDate'
import { confirmationRequestId } from '@/domain/transactions/ingest/review'
import type { TransactionCandidate } from '@/domain/transactions/ingest/TransactionCandidate'
import { LEDGER_KEYS, queryKeys } from '@/lib/queryKeys'
import {
  ACCOUNTS,
  BANK,
  CATEGORIES,
  SAVINGS,
  candidateOf,
  categoryId,
  MESSAGES,
  RULES,
  transactionRow,
  USER_ID,
  uuid,
} from '@tests/fixtures/detection'
import { TEST_SUPABASE_URL } from '@tests/setup/env'
import { server } from '@tests/setup/msw/server'

import { ReviewCandidate } from './ReviewCandidate'

const REST = `${TEST_SUPABASE_URL}/rest/v1`

interface MockLedger {
  readonly rows: Record<string, unknown>[]
  readonly inserts: Record<string, unknown>[]
}

/**
 * PostgREST for `transactions`, as the repository meets it: a GET by
 * client_request_id (the exact duplicate check), a GET of nearby rows (the
 * fuzzy check), and the INSERT. Like the real table, a repeated
 * client_request_id is refused (409) rather than stored twice.
 */
function mockLedger(initial: Record<string, unknown>[] = []): MockLedger {
  const ledger: MockLedger = { rows: [...initial], inserts: [] }
  server.use(
    http.get(`${REST}/transactions`, ({ request }) => {
      const key = new URL(request.url).searchParams.get('client_request_id')
      if (key === null) return HttpResponse.json(ledger.rows)
      return HttpResponse.json(
        ledger.rows.filter((row) => `eq.${String(row.client_request_id)}` === key),
      )
    }),
    http.post(`${REST}/transactions`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      ledger.inserts.push(body)
      if (ledger.rows.some((row) => row.client_request_id === body.client_request_id)) {
        return HttpResponse.json(
          {
            code: '23505',
            message: 'duplicate key value violates unique constraint "tx_client_request_uk"',
          },
          { status: 409 },
        )
      }
      const row = transactionRow({ ...body, id: uuid(700 + ledger.inserts.length) })
      ledger.rows.push(row)
      return HttpResponse.json(row, { status: 201 })
    }),
  )
  return ledger
}

function renderReview(
  candidate: TransactionCandidate = candidateOf(MESSAGES.expense),
  options: { readonly onMerged?: ReturnType<typeof vi.fn> } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const onRejected = vi.fn()
  const onAdded = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <ReviewCandidate
            candidate={candidate}
            userId={USER_ID}
            accounts={ACCOUNTS}
            categories={CATEGORIES}
            rules={RULES}
            today={of(2026, 10, 5)}
            currency="INR"
            locale="en-IN"
            onRejected={onRejected}
            onAdded={onAdded}
            {...(options.onMerged === undefined ? {} : { onMerged: options.onMerged })}
          />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...view, invalidate, onRejected, onAdded, user: userEvent.setup() }
}

/** The value shown beside a label in the review summary. */
function shown(label: string): string {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent ?? ''
}

const confirmButton = () => screen.getByRole('button', { name: 'Confirm & Add' })

describe('ReviewCandidate', () => {
  it('shows the parsed candidate for review and writes nothing on its own', async () => {
    const ledger = mockLedger()
    renderReview()

    expect(screen.getByRole('heading', { name: 'Review transaction' })).toBeInTheDocument()
    expect(shown('Amount')).toContain('486')
    expect(shown('Merchant')).toBe('Swiggy')
    expect(shown('Category')).toBe('Food')
    expect(shown('Type')).toBe('Expense')
    expect(shown('Date')).toBe('2026-10-03')
    expect(shown('Account')).toBe('SBI')
    expect(shown('Confidence')).toBe('100/100 (high)')
    await waitFor(() => expect(confirmButton()).toBeEnabled())
    expect(ledger.inserts).toHaveLength(0)
  })

  it('waits for the duplicate check before it can confirm', async () => {
    let release = () => {}
    const checked = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get(`${REST}/transactions`, async () => {
        await checked
        return HttpResponse.json([])
      }),
    )
    renderReview()
    expect(confirmButton()).toBeDisabled()
    expect(screen.getByText('Checking for duplicates…')).toBeInTheDocument()

    release()
    await waitFor(() => expect(confirmButton()).toBeEnabled())
  })

  it('Confirm & Add writes one transaction through the normal path, then refreshes every ledger view', async () => {
    const ledger = mockLedger()
    const candidate = candidateOf(MESSAGES.expense)
    const { user, invalidate, onAdded } = renderReview(candidate)

    await waitFor(() => expect(confirmButton()).toBeEnabled())
    await user.click(confirmButton())

    expect(await screen.findByText('Added to your ledger')).toBeInTheDocument()
    expect(ledger.inserts).toHaveLength(1)
    expect(ledger.inserts[0]).toMatchObject({
      user_id: USER_ID,
      kind: 'expense',
      amount_minor: 48_600,
      currency_code: 'INR',
      account_id: BANK.id,
      category_id: categoryId('food'),
      merchant_label: 'Swiggy',
      description: 'Swiggy',
      occurred_on: '2026-10-03',
      client_request_id: confirmationRequestId(candidate.fingerprint),
    })
    expect(onAdded).toHaveBeenCalledTimes(1)
    // Exactly the entry form's invalidation: every ledger view, plus the rules.
    for (const queryKey of [...LEDGER_KEYS, queryKeys.merchantRules()]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
    }
  })

  it('sends only the reviewed fields — never the message text', async () => {
    const ledger = mockLedger()
    const { user } = renderReview()
    await waitFor(() => expect(confirmButton()).toBeEnabled())
    await user.click(confirmButton())
    await screen.findByText('Added to your ledger')

    const sent = JSON.stringify(ledger.inserts)
    expect(sent).not.toContain('HDFC Bank')
    expect(sent).not.toContain('900000000021')
    expect(sent).not.toContain('Sent Rs')
    expect(Object.keys(ledger.inserts[0] ?? {})).not.toEqual(
      expect.arrayContaining(['source', 'status', 'dedupe_hash', 'metadata']),
    )
  })

  it('flags the same message confirmed before as a duplicate and refuses to add it again', async () => {
    const candidate = candidateOf(MESSAGES.expense)
    const ledger = mockLedger()

    const first = renderReview(candidate)
    await waitFor(() => expect(confirmButton()).toBeEnabled())
    await first.user.click(confirmButton())
    await screen.findByText('Added to your ledger')
    first.unmount()

    renderReview(candidate)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Possible duplicate transaction')
    expect(alert).toHaveTextContent('This message was already added')
    expect(alert).toHaveTextContent('bank reference (900000000021)')
    expect(alert).toHaveTextContent(confirmationRequestId(candidate.fingerprint))
    expect(confirmButton()).toBeDisabled()
    expect(ledger.inserts).toHaveLength(1)
  })

  it('warns about a similar transaction already in the ledger, but lets a person add it', async () => {
    mockLedger([
      transactionRow({ id: uuid(800), description: 'Swiggy dinner', client_request_id: uuid(801) }),
    ])
    renderReview()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A similar transaction is already in your ledger')
    expect(alert).toHaveTextContent('same amount, same type, same day, same account, same merchant')
    expect(confirmButton()).toBeEnabled()
  })

  it('saves the edited values, under the same duplicate key', async () => {
    const ledger = mockLedger()
    const candidate = candidateOf(MESSAGES.expense)
    const { user } = renderReview(candidate)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '500')
    await user.clear(screen.getByLabelText('Merchant'))
    await user.type(screen.getByLabelText('Merchant'), 'Swiggy Instamart')
    await user.selectOptions(screen.getByLabelText('Account'), 'Airtel Payments Bank')
    await waitFor(() => expect(confirmButton()).toBeEnabled())
    await user.click(confirmButton())

    await screen.findByText('Added to your ledger')
    expect(ledger.inserts[0]).toMatchObject({
      amount_minor: 50_000,
      description: 'Swiggy Instamart',
      account_id: ACCOUNTS[1]?.id,
      client_request_id: confirmationRequestId(candidate.fingerprint),
    })
  })

  it('makes a person choose the type when the message did not say, then adds what they chose', async () => {
    const ledger = mockLedger()
    const { user } = renderReview(candidateOf(MESSAGES.unknown))
    expect(shown('Type')).toBe('Unknown — choose one')

    await waitFor(() => expect(confirmButton()).toBeEnabled())
    await user.click(confirmButton())
    expect(
      await screen.findByText(
        'Choose the type: the message does not say which way the money went.',
      ),
    ).toBeInTheDocument()
    expect(ledger.inserts).toHaveLength(0)

    await user.selectOptions(screen.getByLabelText('Type'), 'Expense')
    expect(screen.getByLabelText('Category')).toHaveValue(categoryId('transport'))
    await user.click(confirmButton())

    await screen.findByText('Added to your ledger')
    expect(ledger.inserts[0]).toMatchObject({
      kind: 'expense',
      category_id: categoryId('transport'),
    })
  })

  it('adds income under an income category', async () => {
    const ledger = mockLedger()
    const { user } = renderReview(candidateOf(MESSAGES.income))
    await waitFor(() => expect(confirmButton()).toBeEnabled())
    await user.click(confirmButton())

    await screen.findByText('Added to your ledger')
    expect(ledger.inserts[0]).toMatchObject({
      kind: 'income',
      amount_minor: 5_200_000,
      category_id: categoryId('salary'),
    })
  })

  it('Reject discards the candidate and writes nothing', async () => {
    const ledger = mockLedger()
    const { user, onRejected } = renderReview()
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(onRejected).toHaveBeenCalledTimes(1)
    expect(ledger.inserts).toHaveLength(0)
  })

  it('cannot confirm when the duplicate check fails', async () => {
    // A 400, not a 503: postgrest-js retries a 503 with backoff by design.
    server.use(
      http.get(`${REST}/transactions`, () =>
        HttpResponse.json({ code: 'PGRST100', message: 'failed to parse filter' }, { status: 400 }),
      ),
    )
    renderReview()
    expect(await screen.findByText('Could not check for duplicates')).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })
})

describe('ReviewCandidate — learning and transfers', () => {
  /** merchant_rules as saveUserRule meets it: a lookup for the user's rule, then an insert. */
  function mockRules() {
    const inserts: Record<string, unknown>[] = []
    server.use(
      http.get(`${REST}/merchant_rules`, () => HttpResponse.json(null)),
      http.post(`${REST}/merchant_rules`, async ({ request }) => {
        inserts.push((await request.json()) as Record<string, unknown>)
        return new HttpResponse(null, { status: 201 })
      }),
    )
    return inserts
  }

  it('teaches the payee’s category when no rule spoke for it, so its next message is added', async () => {
    mockLedger()
    const rules = mockRules()
    const { user, onAdded } = renderReview(candidateOf(MESSAGES.sbi))
    await waitFor(() =>
      expect(screen.queryByText('Checking for duplicates…')).not.toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.selectOptions(screen.getByLabelText('Category'), 'Other')
    await user.click(confirmButton())

    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(rules).toEqual([
      expect.objectContaining({
        user_id: USER_ID,
        pattern: 'amit',
        match_type: 'exact',
        merchant_label: 'Amit',
        category_slug: 'other',
        confidence: 0.95,
        priority: 10,
      }),
    ])
  })

  it('teaches nothing when a confident rule already chose the category', async () => {
    mockLedger()
    const rules = mockRules()
    const { user, onAdded } = renderReview()
    await waitFor(() => expect(confirmButton()).toBeEnabled())
    await user.click(confirmButton())
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(rules).toEqual([])
  })

  it('offers to record a debit and a credit between the user’s accounts as one transfer', async () => {
    const debit = transactionRow({
      id: uuid(810),
      amount_minor: 25_000,
      account_id: BANK.id,
      description: 'Amit',
      occurred_on: '2026-10-04',
      client_request_id: uuid(811),
    })
    mockLedger([debit])
    const patches: Record<string, unknown>[] = []
    server.use(
      http.patch(`${REST}/transactions`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        patches.push(body)
        return HttpResponse.json({ ...debit, ...body })
      }),
    )
    const onMerged = vi.fn()
    const { user, onAdded } = renderReview(candidateOf(MESSAGES.airtel), { onMerged })
    await waitFor(() => expect(confirmButton()).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.selectOptions(screen.getByLabelText('Account'), 'Airtel Payments Bank')
    expect(await screen.findByText('Possible transfer between your accounts')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Record as one transfer' }))

    await waitFor(() => expect(onMerged).toHaveBeenCalled())
    expect(patches).toEqual([
      expect.objectContaining({
        kind: 'transfer',
        account_id: BANK.id,
        counter_account_id: SAVINGS.id,
        category_id: null,
      }),
    ])
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('makes no transfer offer where the caller cannot merge (the dev tester)', async () => {
    const debit = transactionRow({ id: uuid(812), amount_minor: 25_000, occurred_on: '2026-10-04' })
    mockLedger([debit])
    const { user } = renderReview(candidateOf(MESSAGES.airtel))
    await waitFor(() => expect(confirmButton()).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.selectOptions(screen.getByLabelText('Account'), 'Airtel Payments Bank')
    expect(screen.queryByText('Possible transfer between your accounts')).not.toBeInTheDocument()
  })
})
