import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * Grouped vertical bars — income against spending, month by month — and a
 * compact sparkline. Values arrive as plain numbers from `toChartValue`,
 * which exists only to scale an axis; the text beside every chart comes from
 * the formatted Money, never from these numbers.
 *
 * Each chart ships a visually hidden table with the same data, so a screen
 * reader gets the numbers rather than a picture of them (ARCHITECTURE.md §F.6).
 */
export interface BarSeries {
  readonly key: string
  readonly label: string
  /** A Tailwind fill class, e.g. `fill-positive`. */
  readonly fillClass: string
  readonly swatchClass: string
}

export interface BarGroup {
  readonly key: string
  readonly label: string
  readonly values: readonly {
    readonly series: string
    readonly value: number
    readonly text: string
  }[]
}

export function GroupedBars({
  series,
  groups,
  caption,
  className,
}: {
  readonly series: readonly BarSeries[]
  readonly groups: readonly BarGroup[]
  readonly caption: string
  readonly className?: string
}) {
  const peak = Math.max(
    1,
    ...groups.flatMap((group) => group.values.map((v) => Math.max(0, v.value))),
  )
  const groupWidth = 100 / Math.max(1, groups.length)
  const barWidth = (groupWidth * 0.7) / Math.max(1, series.length)
  const chartHeight = 100

  return (
    <figure className={cn('flex flex-col gap-3', className)}>
      <svg
        viewBox={`0 0 100 ${chartHeight + 12}`}
        className="h-44 w-full"
        role="img"
        aria-label={caption}
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          x2="100"
          y1={chartHeight}
          y2={chartHeight}
          className="stroke-border"
          strokeWidth="0.4"
        />
        {groups.map((group, groupIndex) =>
          series.map((s, seriesIndex) => {
            const point = group.values.find((v) => v.series === s.key)
            const height = point ? (Math.max(0, point.value) / peak) * (chartHeight - 4) : 0
            const x = groupIndex * groupWidth + groupWidth * 0.15 + seriesIndex * barWidth
            return (
              <rect
                key={`${group.key}-${s.key}`}
                x={x}
                y={chartHeight - height}
                width={Math.max(0.5, barWidth - 0.6)}
                height={height}
                rx="0.8"
                className={s.fillClass}
              />
            )
          }),
        )}
      </svg>
      <div
        aria-hidden="true"
        className="grid text-center text-xs text-text-muted"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, groups.length)}, minmax(0, 1fr))` }}
      >
        {groups.map((group) => (
          <span key={group.key} className="truncate">
            {group.label}
          </span>
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2.5 rounded-sm', s.swatchClass)} />
            {s.label}
          </span>
        ))}
      </figcaption>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.key}>
              <th scope="row">{group.label}</th>
              {series.map((s) => (
                <td key={s.key}>{group.values.find((v) => v.series === s.key)?.text ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** A small daily-spend strip. Zero days render as ₹0, never as gaps. */
export function Sparkbars({
  points,
  caption,
  highlightLast = true,
  className,
}: {
  readonly points: readonly {
    readonly key: string
    readonly label: string
    readonly value: number
    readonly text: ReactNode
  }[]
  readonly caption: string
  readonly highlightLast?: boolean
  readonly className?: string
}) {
  const peak = Math.max(1, ...points.map((p) => Math.max(0, p.value)))
  const width = 100 / Math.max(1, points.length)
  return (
    <figure className={className}>
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        className="h-12 w-full"
        role="img"
        aria-label={caption}
      >
        {points.map((point, index) => {
          const height = Math.max(0.6, (Math.max(0, point.value) / peak) * 28)
          const isLast = highlightLast && index === points.length - 1
          return (
            <rect
              key={point.key}
              x={index * width + width * 0.15}
              y={30 - height}
              width={width * 0.7}
              height={height}
              rx="0.6"
              className={isLast ? 'fill-brand' : 'fill-brand/35'}
            />
          )
        })}
      </svg>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.label}</th>
              <td>{point.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
