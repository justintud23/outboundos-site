// @vitest-environment jsdom
import { describe, it, expect} from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './button'
import { Badge } from './badge'

// Prism theme discipline guards: the primary CTA uses the on-primary text
// token (white) over the indigo-violet primary surface (≈5.3:1 AA), and
// neutral chrome (default badge) must NOT borrow a brand accent.
describe('Prism theme contrast/discipline', () => {
  it('primary button uses the on-primary token over the indigo primary surface (AA)', () => {
    render(<Button>Go</Button>)
    const cls = screen.getByRole('button', { name: 'Go' }).className
    expect(cls).toContain('bg-[var(--accent-indigo)]') // indigo primary surface
    expect(cls).toContain('text-[var(--text-inverse)]') // on-primary (white), AA
    expect(cls).not.toContain('text-white') // use the token, not a raw color
  })

  it('default badge stays neutral — brand accents are reserved as signals', () => {
    render(<Badge>Neutral</Badge>)
    const cls = screen.getByText('Neutral').className
    expect(cls).toContain('text-[var(--text-secondary)]')
    expect(cls).not.toContain('accent-indigo')
    expect(cls).not.toContain('accent-lime')
  })
})
