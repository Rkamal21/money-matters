import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

import { cn } from '@/lib/cn'

/**
 * Toasts: transient, polite, never the only record of anything important.
 * A toast may carry one action — "Undo" after a delete, "Reload" after a
 * conflict (API.md §5.2).
 */
export type ToastTone = 'success' | 'error' | 'info'

export interface ToastInput {
  readonly title: string
  readonly body?: string
  readonly tone?: ToastTone
  readonly action?: { readonly label: string; readonly onAction: () => void }
  /** Milliseconds. Toasts with an action stay a little longer. */
  readonly duration?: number
}

interface ToastItem extends ToastInput {
  readonly id: number
}

interface ToastApi {
  show(toast: ToastInput): void
  dismiss(id: number): void
}

const ToastContext = createContext<ToastApi>({ show: () => undefined, dismiss: () => undefined })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const
const TONES: Readonly<Record<ToastTone, string>> = {
  success: 'text-positive',
  error: 'text-negative',
  info: 'text-brand',
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++
      setToasts((current) => [...current.slice(-2), { ...toast, id }])
      const duration = toast.duration ?? (toast.action ? 7000 : 4500)
      window.setTimeout(() => dismiss(id), duration)
    },
    [dismiss],
  )

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        <ol aria-live="polite" className="flex w-full max-w-md flex-col gap-2">
          {toasts.map((toast) => {
            const tone = toast.tone ?? 'info'
            const Icon = ICONS[tone]
            return (
              <li
                key={toast.id}
                role={tone === 'error' ? 'alert' : 'status'}
                className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-surface p-3 shadow-overlay"
              >
                <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', TONES[tone])} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text">{toast.title}</p>
                  {toast.body && <p className="mt-0.5 text-sm text-text-muted">{toast.body}</p>}
                </div>
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onAction()
                      dismiss(toast.id)
                    }}
                    className="h-9 shrink-0 rounded-md px-2.5 text-sm font-semibold text-brand hover:bg-surface-2"
                  >
                    {toast.action.label}
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => dismiss(toast.id)}
                  className="-m-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            )
          })}
        </ol>
      </section>
    </ToastContext.Provider>
  )
}
