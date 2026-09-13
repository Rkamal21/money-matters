import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { type ReactNode, useRef } from 'react'

import { cn } from '@/lib/cn'

import { IconButton } from './Button'

/**
 * A modal: a bottom sheet on a phone, a centred dialog from `sm` up. Radix
 * supplies the focus trap, Escape-to-close and the `aria-*` wiring
 * (ADR-0014) — hand-rolled modals are where accessibility budgets die.
 */
export interface SheetProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly size?: 'md' | 'lg'
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: SheetProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          ref={contentRef}
          // Focus moves into the dialog on open, as it must; a field marked
          // `data-autofocus` (the amount, on the entry form) takes it instead of
          // the close button, so logging an expense starts with typing.
          onOpenAutoFocus={(event) => {
            const target = contentRef.current?.querySelector<HTMLElement>('[data-autofocus]')
            if (target) {
              event.preventDefault()
              target.focus()
            }
          }}
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border border-border bg-surface shadow-overlay',
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
            size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 pt-4 pb-3 sm:px-5">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-text">{title}</Dialog.Title>
              {description !== undefined && (
                <Dialog.Description className="mt-0.5 text-sm text-text-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close" className="-mt-1 -mr-2">
                <X aria-hidden="true" className="size-5" />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
          {footer !== undefined && (
            <div className="border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A small confirmation: title, consequence, two buttons. */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  busy = false,
  tone = 'danger',
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  readonly description: ReactNode
  readonly confirmLabel: string
  readonly onConfirm: () => void
  readonly busy?: boolean
  readonly tone?: 'danger' | 'primary'
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <div className="flex justify-end gap-2">
          <Dialog.Close asChild>
            <button
              type="button"
              className="h-11 rounded-lg px-4 text-sm font-medium text-text hover:bg-surface-2"
            >
              Cancel
            </button>
          </Dialog.Close>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'h-11 rounded-lg px-4 text-sm font-medium text-on-brand disabled:opacity-60',
              tone === 'danger'
                ? 'bg-negative-strong hover:bg-negative-strong/90'
                : 'bg-brand-strong hover:bg-brand-strong/90',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <span className="sr-only">Confirm to continue.</span>
    </Sheet>
  )
}
