/** Join class names, dropping the falsy ones. The whole of what `clsx` would do here. */
export function cn(...classes: readonly (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}
