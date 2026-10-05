import { beforeEach, describe, expect, it, vi } from 'vitest'

const platform = { name: 'android' }
const remove = vi.fn(() => Promise.resolve())
let listener: ((event: { canGoBack: boolean }) => void) | undefined
const App = {
  addListener: vi.fn((_event: string, handler: (event: { canGoBack: boolean }) => void) => {
    listener = handler
    return Promise.resolve({ remove })
  }),
  minimizeApp: vi.fn(() => Promise.resolve()),
}

vi.mock('@capacitor/app', () => ({ App }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => platform.name } }))

const { leaveApp, onSystemBack } = await import('./systemBack')

beforeEach(() => {
  platform.name = 'android'
  listener = undefined
  vi.clearAllMocks()
})

describe('systemBack port', () => {
  it('listens to the Android back button, passing on whether there is history', () => {
    const handler = vi.fn()
    onSystemBack(handler)
    expect(App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function))
    listener?.({ canGoBack: true })
    expect(handler).toHaveBeenCalledWith({ canGoBack: true })
  })

  it('removes its listener when unsubscribed', async () => {
    const stop = onSystemBack(() => {})
    stop()
    await Promise.resolve()
    await Promise.resolve()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('does nothing on the web, where the browser’s back button already drives the router', () => {
    platform.name = 'web'
    onSystemBack(() => {})()
    expect(App.addListener).not.toHaveBeenCalled()
  })

  it('leaves the app the way Android does at the root: to the background', async () => {
    await leaveApp()
    expect(App.minimizeApp).toHaveBeenCalledTimes(1)
  })
})
