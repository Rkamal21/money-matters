/** A keyset page. `nextCursor` is opaque to callers; `null` means there is no more. */
export interface Page<T> {
  readonly items: readonly T[]
  readonly nextCursor: string | null
}
