import { cn } from '@/lib/cn'

import { identityOf, identityTile } from './identity'

/**
 * Initials on an identity tint — the reference design's avatar, without a
 * photo: profiles store no image, and none is added just for this.
 * Decorative: the person's name is always shown next to it or in the label
 * of the link that holds it.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = Array.from(parts[0] ?? '')[0] ?? ''
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] ?? '')[0] ?? '') : ''
  return `${first}${last}`.toUpperCase() || '₹'
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  readonly name: string
  readonly size?: 'md' | 'lg'
  readonly className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        size === 'lg' ? 'size-12 text-base' : 'size-10 text-sm',
        identityTile(identityOf(name.trim() || 'money-matters')),
        // Ink initials, not the identity colour: text on a tint needs 4.5:1.
        'text-text',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
