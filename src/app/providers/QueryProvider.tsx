import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { toAppError } from '@/lib/errors'

/**
 * TanStack Query defaults — ARCHITECTURE.md §J: staleTime 30 s, gcTime 5 min,
 * two retries with backoff, but only for errors that can succeed on retry. A
 * validation or authorization failure retried is the same failure, slower.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => toAppError(error).retryable && failureCount < 2,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function QueryProvider({
  children,
  client,
}: {
  readonly children: ReactNode
  readonly client?: QueryClient
}) {
  const [queryClient] = useState(() => client ?? createQueryClient())
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
