import { useId } from 'react'

import { cn } from '@/lib/cn'

/**
 * A single choice among a few, built on native radio inputs so arrow keys,
 * Tab and screen readers behave without any code of ours.
 */
export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
  className,
  hideLegend = true,
}: {
  readonly legend: string
  readonly value: T
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly onChange: (value: T) => void
  readonly className?: string
  readonly hideLegend?: boolean
}) {
  const name = useId()
  return (
    <fieldset className={className}>
      <legend className={hideLegend ? 'sr-only' : 'mb-1.5 text-sm font-medium text-text'}>
        {legend}
      </legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-surface-2 p-1">
        {options.map((option) => {
          const checked = option.value === value
          return (
            <label
              key={option.value}
              className={cn(
                'relative flex h-10 cursor-pointer items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors duration-150',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus',
                checked ? 'bg-surface text-text shadow-card' : 'text-text-muted hover:text-text',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** An on/off switch: a checkbox with the switch role, so it announces "on" and "off". */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly label: string
  readonly description?: string
  readonly disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-text">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-text-muted">{description}</span>}
      </label>
      <span className="relative inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer h-7 w-12 cursor-pointer appearance-none rounded-full border border-border-strong/70 bg-surface-2 transition-colors checked:border-brand-strong checked:bg-brand-strong disabled:opacity-60"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 left-1 size-5 rounded-full bg-white shadow-card transition-transform duration-150 peer-checked:translate-x-5"
        />
      </span>
    </div>
  )
}
