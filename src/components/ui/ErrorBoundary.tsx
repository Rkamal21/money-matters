import { Component, type ErrorInfo, type ReactNode } from 'react'

import { toAppError } from '@/lib/errors'
import { logger } from '@/lib/observability/logger'
import { captureException } from '@/lib/observability/sink'

import { ErrorState } from './States'

/**
 * Contains a render failure to the component that failed. Each dashboard
 * widget gets one, so one widget's failure degrades to an inline error while
 * the rest of the dashboard renders (PRODUCT.md §7).
 */
interface Props {
  readonly children: ReactNode
  readonly title?: string
  readonly compact?: boolean
  /** Changing this resets the boundary, e.g. on navigation. */
  readonly resetKey?: unknown
}

interface State {
  readonly error: unknown
  readonly resetKey: unknown
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const appError = toAppError(error)
    // Kind, code and correlation id only — never the message (ARCHITECTURE.md §K).
    logger.error('render.failed', {
      kind: appError.kind,
      code: appError.code,
      correlationId: appError.correlationId,
      outcome: info.componentStack ? 'caught' : 'caught-no-stack',
    })
    captureException(error, {
      kind: appError.kind,
      code: appError.code,
      correlationId: appError.correlationId,
    })
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <ErrorState
          error={toAppError(this.state.error)}
          title={this.props.title ?? 'This part of the page could not be shown'}
          compact={this.props.compact ?? false}
          onRetry={() => this.setState({ error: null })}
        />
      )
    }
    return this.props.children
  }
}
