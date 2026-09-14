/**
 * The reference design's decoration on its dark balance card: soft shapes in
 * the identity hues, tucked into the corners. Purely decorative — hidden from
 * assistive technology, and kept clear of the text so contrast is measured
 * against the card, not against a shape. Place inside a `relative` card and
 * give the card's content `relative` so it paints above.
 */
export function HeroShapes() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -top-10 -right-8 size-24 rounded-full bg-id-blue" />
      <span className="absolute -top-4 right-12 size-10 rounded-full bg-id-yellow" />
      <span className="absolute -bottom-10 -left-10 size-20 rounded-full bg-id-teal" />
    </div>
  )
}
