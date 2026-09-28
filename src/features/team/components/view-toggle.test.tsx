import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), usePathname: () => '/leads', useSearchParams: () => search }))

import { ViewToggle } from './view-toggle'

// Node 22+ can enable a global `localStorage`/`Storage` (the
// `--experimental-webstorage` flag, on by default on some Node versions) that,
// without `--localstorage-file`, silently resolves to a non-functional stub
// instead of jsdom's own Storage implementation — breaking `.clear()`,
// `.getItem()`, etc. regardless of the code under test. Install a small
// Map-backed shim so these tests pass on any Node version.
function createStorageShim(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size },
  } as Storage
}

let originalLocalStorage: PropertyDescriptor | undefined

beforeEach(() => {
  vi.resetAllMocks()
  search = new URLSearchParams()

  const shim = createStorageShim()
  vi.stubGlobal('localStorage', shim)
  originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalLocalStorage) {
    Object.defineProperty(window, 'localStorage', originalLocalStorage)
  }
})

describe('ViewToggle', () => {
  it('shows both options with the current one pressed', () => {
    render(<ViewToggle view="mine" />)
    expect(screen.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switching writes ?view= and remembers the choice', () => {
    render(<ViewToggle view="mine" />)
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    expect(push).toHaveBeenCalledWith('/leads?view=team')
    expect(window.localStorage.getItem('outboundos:view')).toBe('team')
  })

  it('restores the remembered choice when the URL has none', () => {
    window.localStorage.setItem('outboundos:view', 'team')
    render(<ViewToggle view="mine" />)
    expect(replace).toHaveBeenCalledWith('/leads?view=team')
  })

  it('does not override an explicit ?view=', () => {
    search = new URLSearchParams('view=mine')
    window.localStorage.setItem('outboundos:view', 'team')
    render(<ViewToggle view="mine" />)
    expect(replace).not.toHaveBeenCalled()
  })

  it('works when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    render(<ViewToggle view="mine" />)
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    expect(push).toHaveBeenCalledWith('/leads?view=team')
    spy.mockRestore()
  })
})
