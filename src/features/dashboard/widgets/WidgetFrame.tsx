import type { ReactNode } from 'react'

import { CardSection } from '@/components/ui/Card'
import { ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'

import type { DashboardState } from '../hooks/useDashboard'

export interface WidgetProps {
  readonly state: DashboardState
}

/**
 * Every widget's four states in one place: loading (a skeleton the shape of
 * the result), error (with retry), and — via `children` — empty or loaded
 * (ARCHITECTURE.md §F.5 rule 5).
 */
export function WidgetFrame({
  id,
  title,
  action,
  state,
  skeletonRows = 3,
  bare = false,
  className,
  children,
}: {
  readonly id: string
  readonly title: ReactNode
  readonly action?: ReactNode
  readonly state: DashboardState
  readonly skeletonRows?: number
  /** The content is already cards (row cards, tiles): no card around it. */
  readonly bare?: boolean
  readonly className?: string
  readonly children: () => ReactNode
}) {
  let body: ReactNode
  if (state.error !== null && state.snapshot === undefined) {
    body = <ErrorState error={state.error} onRetry={state.retry} compact />
  } else if (state.snapshot === undefined || state.today === null) {
    body = (
      <LoadingBlock label={`Loading ${typeof title === 'string' ? title : 'widget'}`}>
        <div className="flex flex-col gap-3">
          {Array.from({ length: skeletonRows }, (_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      </LoadingBlock>
    )
  } else {
    body = children()
  }

  return (
    <CardSection
      title={title}
      titleId={`widget-${id}`}
      bare={bare}
      {...(action === undefined ? {} : { action })}
      {...(className === undefined ? {} : { className })}
    >
      {body}
    </CardSection>
  )
}
