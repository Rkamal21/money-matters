import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

/**
 * Route changes move focus to the page's <h1> and announce its title
 * (ARCHITECTURE.md §F.6). Without this, a screen-reader user who follows a
 * link hears nothing and is left where the old page's link used to be.
 */
export function RouteAnnouncer() {
  const location = useLocation()
  const [message, setMessage] = useState('')
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    // Wait a frame for the new page (and its lazily loaded chunk) to render.
    const timer = window.setTimeout(() => {
      const heading = document.querySelector<HTMLElement>('main h1')
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
        heading.focus({ preventScroll: false })
      }
      setMessage(document.title)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [location.pathname])

  return (
    <p aria-live="assertive" aria-atomic="true" className="sr-only">
      {message}
    </p>
  )
}
