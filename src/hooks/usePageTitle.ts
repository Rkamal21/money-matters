import { useEffect } from 'react'

/** Sets the document title, which the route announcer reads out on navigation. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Money Matters`
  }, [title])
}
