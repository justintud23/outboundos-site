// @vitest-environment jsdom
import { describe, it, expect} from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './button'
import { Badge } from './badge'

// Signal lime-discipline guards: lime (#B6F23D) surfaces must carry DARK INK
// (--text-inverse), never white; and neutral chrome (default badge) must NOT
// adopt the lime signal. These lock in the theme's contrast + discipline intent.
describe('Signal theme contrast/discipline', () => {
  it('primary button puts dark ink on the lime surface (AA), never white', () => {
    render(<Button>Go</Button>)
    const cls = screen.getByRole('button', { name: 'Go' }).className
    expect(cls).toContain('bg-[var(--accent-indigo)]') // lime signal surface
    expect(cls).toContain('text-[var(--text-inverse)]') // dark ink, AA on lime
    expect(cls).not.toContain('text-white')
  })

  it('default badge stays neutral graphite — lime is reserved as a signal', () => {
    render(<Badge>Neutral</Badge>)
    const cls = screen.getByText('Neutral').className
    expect(cls).toContain('text-[var(--text-secondary)]')
    expect(cls).not.toContain('accent-indigo')
    expect(cls).not.toContain('accent-lime')
  })
})
