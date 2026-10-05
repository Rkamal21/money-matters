import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Textarea } from '@/components/ui/Field'
import { Money } from '@/components/ui/Money'
import { toISO, type LocalDate } from '@/domain/period/LocalDate'
import type { CategoryRule } from '@/domain/transactions/categorize/CategoryRule'
import { parseTransactionMessage } from '@/domain/transactions/ingest/parseTransactionMessage'
import type {
  ParseMessageResult,
  RejectionReason,
  TransactionCandidate,
} from '@/domain/transactions/ingest/TransactionCandidate'
import type { AccountWithBalance, Category } from '@/domain/transactions/types'

import { ReviewCandidate } from './ReviewCandidate'

/**
 * The development-only detection tester: messages in, the parser's verdict out,
 * and — only on "Confirm & Add" — one transaction through the normal write path.
 *
 * Privacy (SECURITY.md §9): message text lives in this component's memory and
 * nowhere else. It is not logged, not put in the URL or localStorage, and not
 * sent anywhere — parsing happens here, and a confirmation sends only the
 * reviewed fields. "Clear" drops it.
 */

interface Run {
  readonly id: number
  readonly text: string
  readonly result: ParseMessageResult
  readonly outcome: 'open' | 'added' | 'rejected'
}

const REJECTION_LABEL: Readonly<Record<RejectionReason, string>> = {
  empty: 'Empty message',
  too_long: 'Too long to be a bank message',
  otp: 'OTP message',
  promotional: 'Promotional message',
  failed: 'Failed transaction',
  not_completed: 'Money has not moved yet',
  no_amount: 'No amount found',
  balance_only: 'Balance only',
  insufficient_evidence: 'Not enough evidence of a transaction',
}

export interface DetectionWorkbenchProps {
  readonly userId: string
  readonly accounts: readonly AccountWithBalance[]
  readonly categories: readonly Category[]
  readonly rules: readonly CategoryRule[]
  readonly today: LocalDate
  readonly currency: string
  readonly locale: string
  /** Reads bank-messages.local through the dev server. Throws with a readable reason. */
  readonly loadLocalMessages: () => Promise<string[]>
}

export function DetectionWorkbench(props: DetectionWorkbenchProps) {
  const { categories, rules, locale } = props
  const [text, setText] = useState('')
  const [runs, setRuns] = useState<readonly Run[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const parse = (messages: readonly string[]): Run[] =>
    messages.map((message, index) => ({
      id: index + 1,
      text: message,
      result: parseTransactionMessage({ text: message, rules, categories }),
      outcome: 'open',
    }))

  const show = (next: Run[]) => {
    setRuns(next)
    setSelectedId(next[0]?.id ?? null)
    setReviewing(false)
  }

  const runPasted = () => {
    setLoadError(null)
    show(parse([text]))
  }

  const loadFile = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      show(parse(await props.loadLocalMessages()))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load bank-messages.local.')
    } finally {
      setLoading(false)
    }
  }

  const clear = () => {
    setText('')
    show([])
  }

  const settle = (id: number, outcome: Run['outcome']) =>
    setRuns((current) => current.map((run) => (run.id === id ? { ...run, outcome } : run)))

  const select = (id: number) => {
    setSelectedId(id)
    setReviewing(false)
  }

  const accepted = runs.filter((run) => run.result.status === 'candidate')
  const rejected = runs.filter((run) => run.result.status === 'rejected')
  const selected = runs.find((run) => run.id === selectedId) ?? null
  const categoryName = (candidate: TransactionCandidate) =>
    candidate.category === null
      ? '—'
      : (categories.find((category) => category.slug === candidate.category?.categorySlug)?.name ??
        candidate.category.categorySlug)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-caution uppercase">
          Development only
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Transaction detection</h1>
        <p className="text-sm text-text-muted">
          Paste a bank or UPI message, or load <code>bank-messages.local</code>. Parsing happens in
          this tab. Nothing is saved until you review a result and press Confirm &amp; Add.
        </p>
      </header>

      <Card className="flex flex-col gap-3">
        <Field label="Bank or UPI message">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={text}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runPasted} disabled={text.trim() === ''}>
            Run parser
          </Button>
          <Button variant="secondary" onClick={() => void loadFile()} loading={loading}>
            Load bank-messages.local
          </Button>
          <Button variant="ghost" onClick={clear} disabled={runs.length === 0 && text === ''}>
            Clear
          </Button>
        </div>
        {loadError !== null ? (
          <p role="alert" className="text-sm text-negative">
            {loadError}
          </p>
        ) : null}
      </Card>

      {runs.length > 0 ? (
        <section aria-labelledby="results-heading" className="flex flex-col gap-4">
          <h2 id="results-heading" className="text-lg font-semibold text-text">
            Results: {runs.length} message{runs.length === 1 ? '' : 's'} · {accepted.length}{' '}
            accepted · {rejected.length} rejected
          </h2>

          {accepted.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Accepted messages</caption>
                <thead className="text-text-muted">
                  <tr>
                    {[
                      '#',
                      'Result',
                      'Amount',
                      'Direction',
                      'Merchant',
                      'Category',
                      'Confidence',
                      'Fingerprint',
                      '',
                    ].map((heading, index) => (
                      <th key={index} scope="col" className="px-2 py-1 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accepted.map((run) => {
                    if (run.result.status !== 'candidate') return null
                    const c = run.result.candidate
                    return (
                      <tr key={run.id} className="border-t border-card-border">
                        <td className="px-2 py-1">{run.id}</td>
                        <td className="px-2 py-1">{outcomeLabel(run, 'Accepted')}</td>
                        <td className="px-2 py-1">
                          <Money value={c.amount} locale={locale} />
                        </td>
                        <td className="px-2 py-1">{c.direction}</td>
                        <td className="px-2 py-1">{c.merchant ?? '—'}</td>
                        <td className="px-2 py-1">{categoryName(c)}</td>
                        <td className="px-2 py-1">
                          {c.confidence.score} ({c.confidence.level})
                        </td>
                        <td className="px-2 py-1 font-mono text-xs" title={c.fingerprint.value}>
                          {c.fingerprint.value.slice(0, 12)}…
                        </td>
                        <td className="px-2 py-1">
                          <InspectButton run={run} onClick={() => select(run.id)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {rejected.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Rejected messages</caption>
                <thead className="text-text-muted">
                  <tr>
                    {['#', 'Result', 'Rejection reason', ''].map((heading, index) => (
                      <th key={index} scope="col" className="px-2 py-1 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rejected.map((run) =>
                    run.result.status === 'rejected' ? (
                      <tr key={run.id} className="border-t border-card-border">
                        <td className="px-2 py-1">{run.id}</td>
                        <td className="px-2 py-1">Rejected</td>
                        <td className="px-2 py-1">
                          {REJECTION_LABEL[run.result.reason]} (<code>{run.result.reason}</code>)
                        </td>
                        <td className="px-2 py-1">
                          <InspectButton run={run} onClick={() => select(run.id)} />
                        </td>
                      </tr>
                    ) : null,
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {selected !== null ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-text">Message #{selected.id}</h2>

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-text-muted">Input</h3>
            <blockquote
              aria-label="Original message"
              className="rounded-lg bg-surface-2 p-3 font-mono text-xs break-words whitespace-pre-wrap text-text"
            >
              {selected.text}
            </blockquote>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-text-muted">Parsed result</h3>
            <ParsedResult result={selected.result} categoryName={categoryName} locale={locale} />
          </div>

          {selected.result.status === 'candidate' && selected.outcome === 'open' && !reviewing ? (
            <div>
              <Button onClick={() => setReviewing(true)}>Review transaction</Button>
            </div>
          ) : null}

          {selected.outcome === 'rejected' ? (
            <p role="status" className="text-sm text-text-muted">
              Rejected. Nothing was saved.
            </p>
          ) : null}

          {selected.result.status === 'candidate' &&
          reviewing &&
          selected.outcome !== 'rejected' ? (
            <ReviewCandidate
              key={selected.id}
              candidate={selected.result.candidate}
              userId={props.userId}
              accounts={props.accounts}
              categories={props.categories}
              rules={props.rules}
              today={props.today}
              currency={props.currency}
              locale={props.locale}
              onRejected={() => {
                settle(selected.id, 'rejected')
                setReviewing(false)
              }}
              onAdded={() => settle(selected.id, 'added')}
            />
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}

function outcomeLabel(run: Run, open: string): string {
  return run.outcome === 'added' ? 'Added' : run.outcome === 'rejected' ? 'Rejected by you' : open
}

function InspectButton({ run, onClick }: { readonly run: Run; readonly onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} aria-label={`Inspect message ${run.id}`}>
      Inspect
    </Button>
  )
}

function ParsedResult({
  result,
  categoryName,
  locale,
}: {
  readonly result: ParseMessageResult
  readonly categoryName: (candidate: TransactionCandidate) => string
  readonly locale: string
}) {
  if (result.status === 'rejected') {
    return (
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-muted">Result</dt>
        <dd>Rejected</dd>
        <dt className="text-text-muted">Rejection reason</dt>
        <dd>
          {REJECTION_LABEL[result.reason]} (<code>{result.reason}</code>)
        </dd>
      </dl>
    )
  }
  const c = result.candidate
  const rows: readonly (readonly [string, ReactNode])[] = [
    ['Result', 'Accepted'],
    ['Amount', <Money key="amount" value={c.amount} locale={locale} />],
    ['Currency', c.amount.currency],
    ['Direction', c.direction],
    ['Transaction kind', c.kind ?? 'unknown — a person decides'],
    ['Merchant', c.merchant === null ? '—' : `${c.merchant} (as written: ${c.merchantRaw ?? '—'})`],
    ['Category', categoryName(c)],
    [
      'Date',
      c.occurredOn === null
        ? 'Not in the message'
        : `${toISO(c.occurredOn)} (${c.occurredOnSource ?? ''})`,
    ],
    ['Time', c.occurredTime ?? '—'],
    ['Reference', c.reference ?? '—'],
    ['Account last 4', c.accountLast4 ?? '—'],
    ['Confidence', `${c.confidence.score}/100`],
    ['Confidence level', c.confidence.level],
    [
      'Confidence breakdown',
      c.confidence.breakdown.map((item) => `${item.factor} +${item.points}`).join(', '),
    ],
    ['Fingerprint', `${c.fingerprint.value} (${c.fingerprint.basis})`],
  ]
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className={label === 'Fingerprint' ? 'font-mono text-xs break-all' : undefined}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
