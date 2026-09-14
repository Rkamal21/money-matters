import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

import { CATEGORY_STROKE, CATEGORY_SWATCH } from '../ui/CategoryIcon'

/**
 * Where the money went, as a ring. Pure presentation: the shares arrive
 * already computed by `domain/transactions/aggregateByCategory`.
 *
 * Accessible by construction: the SVG is one labelled image, and the legend
 * beside it is a real list with every value in text — the table fallback
 * ARCHITECTURE.md §F.6 asks every chart for.
 */
export interface DonutSlice {
  readonly key: string
  readonly label: string
  /** 0..1 */
  readonly share: number
  readonly color: string
  /** The value as text, e.g. "₹6,200". */
  readonly valueText: ReactNode
}

const RADIUS = 40
const STROKE = 14
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function CategoryDonut({
  slices,
  centerLabel,
  centerValue,
  ariaLabel,
  className,
}: {
  readonly slices: readonly DonutSlice[]
  readonly centerLabel: string
  readonly centerValue: ReactNode
  readonly ariaLabel: string
  readonly className?: string
}) {
  const arcs: { key: string; color: string; dash: number; offset: number }[] = []
  let offset = 0
  for (const slice of slices) {
    const length = Math.max(0, Math.min(1, slice.share)) * CIRCUMFERENCE
    arcs.push({ key: slice.key, color: slice.color, dash: length, offset })
    offset += length
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6',
        className,
      )}
    >
      <div className="relative size-40 shrink-0">
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label={ariaLabel}
          className="size-full -rotate-90"
        >
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-surface-2"
          />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx="50"
              cy="50"
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
              strokeDashoffset={-arc.offset}
              className={cn(
                CATEGORY_STROKE[arc.color] ?? 'stroke-cat-neutral',
                'transition-[stroke-dasharray] duration-200',
              )}
            />
          ))}
        </svg>
        <div
          aria-hidden="true"
          className="absolute inset-0 flex flex-col items-center justify-center text-center"
        >
          <span className="text-xs text-text-muted">{centerLabel}</span>
          <span className="text-lg font-semibold text-text">{centerValue}</span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-2">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                CATEGORY_SWATCH[slice.color] ?? 'bg-cat-neutral',
              )}
            />
            <span className="min-w-0 flex-1 truncate text-text">{slice.label}</span>
            <span className="text-text-muted tabular">{Math.round(slice.share * 100)}%</span>
            <span className="w-24 text-right font-medium text-text">{slice.valueText}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
