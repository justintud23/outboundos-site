import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LeadsTable } from './leads-table'
import type { LeadDTO } from '../types'

const base: LeadDTO = {
  id: 'lead-1', email: 'jane@acmepm.com', firstName: 'Jane', lastName: 'Doe', company: 'Acme PM', title: null,
  source: 'CSV', status: 'NEW', score: null, scoreReason: null, scoredAt: null, createdAt: new Date('2026-09-01'),
  emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null,
}

describe('LeadsTable — CASL', () => {
  it('labels a Canadian lead as excluded, with the reason on hover', () => {
    render(<LeadsTable leads={[{ ...base, canadaExclusion: 'email ends in .ca' }]} />)
    const badge = screen.getByText('Excluded: Canada (CASL)')
    expect(badge.closest('span[title]')).toHaveAttribute('title', expect.stringContaining('email ends in .ca'))
  })

  it('shows no exclusion label for other leads', () => {
    render(<LeadsTable leads={[{ ...base, canadaExclusion: null }]} />)
    expect(screen.queryByText('Excluded: Canada (CASL)')).not.toBeInTheDocument()
  })
})
