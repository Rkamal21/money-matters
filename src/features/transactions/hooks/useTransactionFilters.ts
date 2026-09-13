import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import type { TransactionFilter } from '@/data/repositories'
import { tryFromISO } from '@/domain/period/LocalDate'
import type { TransactionKind } from '@/domain/transactions/types'

/**
 * Filters live in the URL, not in React state (ARCHITECTURE.md §F.3): a
 * filtered view is a shareable link, reload restores it, and the back button
 * — including Android's — steps back through filter changes.
 *
 *   ?q=swiggy&kind=expense,refund&category=<id>,<id>&account=<id>&from=2026-09-01&to=2026-09-30
 */

const KINDS: readonly TransactionKind[] = ['expense', 'income', 'transfer', 'refund']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function list(value: string | null): string[] {
  return value === null || value === '' ? [] : value.split(',').filter((item) => item !== '')
}

export interface FilterState {
  readonly q: string
  readonly kinds: readonly TransactionKind[]
  readonly categoryIds: readonly string[]
  readonly accountIds: readonly string[]
  readonly from: string
  readonly to: string
}

export function useTransactionFilters() {
  const [params, setParams] = useSearchParams()

  const state = useMemo<FilterState>(
    () => ({
      q: params.get('q') ?? '',
      kinds: list(params.get('kind')).filter((kind): kind is TransactionKind =>
        KINDS.includes(kind as TransactionKind),
      ),
      categoryIds: list(params.get('category')).filter((id) => UUID.test(id)),
      accountIds: list(params.get('account')).filter((id) => UUID.test(id)),
      from: tryFromISO(params.get('from') ?? '') === null ? '' : (params.get('from') ?? ''),
      to: tryFromISO(params.get('to') ?? '') === null ? '' : (params.get('to') ?? ''),
    }),
    [params],
  )

  const filter = useMemo<TransactionFilter>(
    () => ({
      query: state.q,
      kinds: state.kinds,
      categoryIds: state.categoryIds,
      accountIds: state.accountIds,
      from: tryFromISO(state.from),
      to: tryFromISO(state.to),
    }),
    [state],
  )

  const update = useCallback(
    (patch: Partial<FilterState>, options: { replace?: boolean } = {}) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          const set = (key: string, value: string) => {
            if (value === '') next.delete(key)
            else next.set(key, value)
          }
          if (patch.q !== undefined) set('q', patch.q)
          if (patch.kinds !== undefined) set('kind', patch.kinds.join(','))
          if (patch.categoryIds !== undefined) set('category', patch.categoryIds.join(','))
          if (patch.accountIds !== undefined) set('account', patch.accountIds.join(','))
          if (patch.from !== undefined) set('from', patch.from)
          if (patch.to !== undefined) set('to', patch.to)
          return next
        },
        { replace: options.replace ?? false },
      )
    },
    [setParams],
  )

  const activeCount =
    (state.kinds.length > 0 ? 1 : 0) +
    (state.categoryIds.length > 0 ? 1 : 0) +
    (state.accountIds.length > 0 ? 1 : 0) +
    (state.from !== '' || state.to !== '' ? 1 : 0)

  const clear = useCallback(() => setParams(new URLSearchParams()), [setParams])

  return { state, filter, update, clear, activeCount }
}
