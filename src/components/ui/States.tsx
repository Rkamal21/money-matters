import { CircleAlert, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'

import type { AppError } from '@/domain/errors/AppError'
import { cn } from '@/lib/cn'

import { Button } from './Button'

/**
 * Four states per data surface, always: loading (a skeleton shaped like the
 * result, not a spinner), empty (with the action that fills it), error (with
 * a retry), loaded. These two are shared so no feature invents its own
 * (ARCHITECTURE.md §F.5 rule 5).
 */

export function Skeleton({ className }: { readonly className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-surface-2', className)} />
  )
}

/** A labelled loading region: sighted users see the skeleton, screen readers hear "Loading". */
export function LoadingBlock({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  readonly icon?: ReactNode
  readonly title: string
  readonly body?: ReactNode
  readonly action?: ReactNode
  readonly className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-8 text-center', className)}>
      {icon && (
        <div
          aria-hidden="true"
          className="mb-1 flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand"
        >
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-text">{title}</p>
      {body && <p className="max-w-sm text-sm text-text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title = 'This could not be loaded',
  compact = false,
}: {
  readonly error: AppError | null | undefined
  readonly onRetry?: () => void
  readonly title?: string
  readonly compact?: boolean
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 text-left',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-negative">
        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
        {title}
      </p>
      <p className="text-sm text-text-muted">
        {error?.userMessage ?? 'Something went wrong. Please try again.'}
        {error?.correlationId && (
          <span className="block text-xs">
            Reference <span className="tabular">{error.correlationId}</span>
          </span>
        )}
      </p>
      {onRetry && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onRetry}
          icon={<RotateCcw aria-hidden="true" className="size-4" />}
        >
          Try again
        </Button>
      )}
    </div>
  )
}
