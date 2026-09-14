import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * Cards follow the Financy reference design: white on the grey ground, soft
 * corners, a hairline only for crispness. A section's title sits above its
 * card, on the ground — not inside it.
 */
export const CARD_CLASS = 'rounded-2xl border border-card-border bg-surface p-4 shadow-card sm:p-5'

/** One list item as its own card — the reference's transaction and savings rows. */
export const ROW_CARD_CLASS =
  'block rounded-2xl border border-card-border bg-surface px-3 shadow-card transition-colors duration-150 hover:bg-surface-2'

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div className={cn(CARD_CLASS, className)} {...rest}>
      {children}
    </div>
  )
}

/** A section title with an optional action on its right ("See all"). */
export function SectionHeader({
  title,
  titleId,
  action,
}: {
  readonly title: ReactNode
  readonly titleId: string
  readonly action?: ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-0.5">
      <h2 id={titleId} className="text-lg font-semibold tracking-tight text-text">
        {title}
      </h2>
      {action}
    </div>
  )
}

/**
 * A landmark named by its own heading, with its content in a card. `bare`
 * drops the card for content that is already cards (a list of row cards, a
 * grid of tiles). `className` styles the content, as it always has.
 */
export function CardSection({
  title,
  titleId,
  action,
  bare = false,
  className,
  children,
}: {
  readonly title: ReactNode
  readonly titleId: string
  readonly action?: ReactNode
  readonly bare?: boolean
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <SectionHeader title={title} titleId={titleId} action={action} />
      <div className={bare ? className : cn(CARD_CLASS, className)}>{children}</div>
    </section>
  )
}
