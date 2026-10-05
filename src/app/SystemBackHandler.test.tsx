import * as Dialog from '@radix-ui/react-dialog'
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SystemBackEvent } from '@/platform/navigation/systemBack'

import { SystemBackHandler } from './SystemBackHandler'

/**
 * Android's system Back, driven through the platform port: what one press does
 * at each depth of the router's history, and with a dialog open.
 */

const port = vi.hoisted(() => ({
  handlers: [] as ((event: SystemBackEvent) => void)[],
  unsubscribe: vi.fn(),
  leaveApp: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/platform/navigation/systemBack', () => ({
  onSystemBack: (handler: (event: SystemBackEvent) => void) => {
    port.handlers.push(handler)
    return () => {
      port.unsubscribe()
      port.handlers.splice(port.handlers.indexOf(handler), 1)
    }
  },
  leaveApp: port.leaveApp,
}))

function Where() {
  return <output aria-label="Location">{useLocation().pathname}</output>
}

function OpenSheet() {
  const [open, setOpen] = useState(true)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>Edit goal</Dialog.Title>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function renderAt(entries: string[], withSheet = false) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <SystemBackHandler />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
      {withSheet ? <OpenSheet /> : null}
    </MemoryRouter>,
  )
}

/** One press of Android Back. `canGoBack` mirrors the router's history position. */
function pressBack(canGoBack: boolean) {
  act(() => {
    for (const handler of port.handlers) handler({ canGoBack })
  })
}

const location = () => screen.getByRole('status', { name: 'Location' }).textContent

beforeEach(() => {
  port.handlers.length = 0
  vi.clearAllMocks()
})

describe('SystemBackHandler — Android system Back', () => {
  it('registers exactly one handler, and removes it on unmount', () => {
    const view = renderAt(['/dashboard'])
    expect(port.handlers).toHaveLength(1)
    view.unmount()
    expect(port.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('goes back one route from a nested screen: wallet detail → wallets', () => {
    renderAt(['/dashboard', '/wallets', '/wallets/w1'])
    pressBack(true)
    expect(location()).toBe('/wallets')
    expect(port.leaveApp).not.toHaveBeenCalled()
  })

  it('takes one step per press — never two', () => {
    renderAt(['/dashboard', '/settings', '/detected', '/detected/d1'])
    pressBack(true)
    expect(location()).toBe('/detected')
    pressBack(true)
    expect(location()).toBe('/settings')
  })

  it('stays subscribed exactly once while the route changes, so no press is handled twice', () => {
    renderAt(['/dashboard', '/wallets', '/wallets/w1'])
    pressBack(true)
    pressBack(true)
    expect(port.handlers).toHaveLength(1)
    expect(port.unsubscribe).not.toHaveBeenCalled()
  })

  it('walks back to the root, and only there leaves the app', () => {
    renderAt(['/dashboard', '/goals', '/goals/g1'])
    pressBack(true)
    pressBack(true)
    expect(location()).toBe('/dashboard')
    expect(port.leaveApp).not.toHaveBeenCalled()
    pressBack(false)
    expect(location()).toBe('/dashboard')
    expect(port.leaveApp).toHaveBeenCalledTimes(1)
  })

  it('closes an open dialog or sheet first, without navigating', async () => {
    renderAt(['/dashboard', '/goals/g1'], true)
    expect(await screen.findByRole('dialog', { name: 'Edit goal' })).toBeInTheDocument()

    pressBack(true)

    expect(screen.queryByRole('dialog', { name: 'Edit goal' })).not.toBeInTheDocument()
    expect(location()).toBe('/goals/g1')
    expect(port.leaveApp).not.toHaveBeenCalled()

    pressBack(true)
    expect(location()).toBe('/dashboard')
  })
})
