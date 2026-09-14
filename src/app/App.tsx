import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router'

import { ToastProvider } from '@/components/ui/Toast'

import { AuthProvider } from './providers/AuthProvider'
import { QueryProvider } from './providers/QueryProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { RouteAnnouncer } from './RouteAnnouncer'
import { AppRoutes } from './router'

/**
 * The composition root. Wires everything, owns nothing (ARCHITECTURE.md §F.1).
 *
 * Provider order matters: the query client is outermost because signing out
 * clears it; auth sits inside it for that reason; theme and toasts need
 * neither.
 */
export function AppProviders({
  children,
  queryClient,
}: {
  readonly children: ReactNode
  readonly queryClient?: QueryClient
}) {
  return (
    <QueryProvider {...(queryClient === undefined ? {} : { client: queryClient })}>
      <AuthProvider>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryProvider>
  )
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <RouteAnnouncer />
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  )
}
