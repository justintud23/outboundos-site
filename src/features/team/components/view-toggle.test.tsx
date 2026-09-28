import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), usePathname: () => '/leads', useSearchParams: () => search }))

import { ViewToggle } from './view-toggle'

beforeEach(() => { vi.resetAllMocks(); search = new URLSearchParams(); window.localStorage.clear() })

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
