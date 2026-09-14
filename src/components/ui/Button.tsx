import { LoaderCircle } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'bg-brand-strong text-on-brand shadow-card hover:bg-brand-strong/90 active:bg-brand-strong/80',
  secondary: 'border border-border-strong/50 bg-surface text-text hover:bg-surface-2',
  ghost: 'text-text hover:bg-surface-2',
  danger: 'bg-negative-strong text-on-brand hover:bg-negative-strong/90',
}

/** `md` and `lg` clear the 44×44 px touch target (ARCHITECTURE.md §F.5 rule 6). */
const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-9 gap-1.5 px-3 text-sm',
  md: 'h-11 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-5 text-base',
}

export interface ButtonProps extends ComponentProps<'button'> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** Disables the button and shows a spinner; the label stays for screen readers. */
  readonly loading?: boolean
  readonly block?: boolean
  readonly icon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors duration-150 select-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ComponentProps<'button'> {
  /** Required: an icon-only button has no other accessible name. */
  readonly label: string
  readonly variant?: 'ghost' | 'secondary'
}

export function IconButton({
  label,
  variant = 'ghost',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'ghost'
          ? 'hover:bg-surface-2'
          : 'border border-border bg-surface hover:bg-surface-2',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
