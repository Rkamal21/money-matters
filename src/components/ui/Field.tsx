import { CircleAlert } from 'lucide-react'
import { type ComponentProps, type ReactNode, useId } from 'react'

import { cn } from '@/lib/cn'

/**
 * Every input goes through `Field`, which wires the label, the hint and the
 * error so it is not possible to render an unlabelled control
 * (ARCHITECTURE.md §F.6).
 */
export interface ControlProps {
  readonly id: string
  readonly 'aria-describedby': string | undefined
  readonly 'aria-invalid': true | undefined
}

export interface FieldProps {
  readonly label: ReactNode
  readonly hint?: ReactNode
  readonly error?: string | undefined
  readonly optional?: boolean
  readonly className?: string
  readonly children: (control: ControlProps) => ReactNode
}

export function Field({ label, hint, error, optional = false, className, children }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {optional && <span className="font-normal text-text-muted"> (optional)</span>}
      </label>
      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-xs font-medium text-negative"
        >
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

const CONTROL =
  'w-full rounded-lg border border-border-strong/70 bg-surface text-base text-text placeholder:text-text-muted/80 ' +
  'transition-colors duration-150 hover:border-border-strong focus-visible:border-brand ' +
  'aria-[invalid=true]:border-negative disabled:cursor-not-allowed disabled:opacity-60'

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL, 'h-11 px-3', className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL, 'min-h-20 px-3 py-2.5', className)} {...rest} />
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select className={cn(CONTROL, 'h-11 appearance-none pr-9 pl-3', className)} {...rest}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
      >
        <path
          d="M5 7.5 10 12.5 15 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

/**
 * A money field: large, tabular, with the currency symbol outside the value so
 * a pasted "₹1,234" and a typed "1234" parse the same. `inputMode="decimal"`
 * brings up the number pad on a phone — entry speed is a product principle
 * (PRODUCT.md §4.3).
 */
export function AmountInput({
  className,
  symbol = '₹',
  scale = 'md',
  ...rest
}: Omit<ComponentProps<'input'>, 'size'> & {
  readonly symbol?: string
  readonly scale?: 'md' | 'xl'
}) {
  const size = scale
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-medium text-text-muted',
          size === 'xl' ? 'text-2xl' : 'text-base',
        )}
      >
        {symbol}
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn(
          CONTROL,
          'tabular',
          size === 'xl' ? 'h-16 pl-9 text-3xl font-semibold' : 'h-11 pl-8',
          className,
        )}
        {...rest}
      />
    </div>
  )
}
