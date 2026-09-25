import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmailCheckBadge } from './email-check-badge'
import { VerificationCard } from './verification-card'

describe('EmailCheckBadge', () => {
  it.each([
    ['UNCHECKED', 'Not checked'], ['PENDING', 'Verifying'], ['OK', 'Verified'], ['RISKY', 'Risky'], ['INVALID', 'Invalid'],
  ] as const)('%s renders "%s"', (check, label) => {
    render(<EmailCheckBadge check={check} result={null} checkedAt={null} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('names the result for screen readers', () => {
    render(<EmailCheckBadge check="RISKY" result="catch_all" checkedAt="2026-09-20T00:00:00Z" />)
    expect(screen.getByLabelText('Email risky (catch_all)')).toBeInTheDocument()
  })
})

describe('VerificationCard', () => {
  it('shows counts', () => {
    render(<VerificationCard summary={{ configured: true, pending: 3, risky: 2, invalid: 1, pausedReason: null }} />)
    expect(screen.getByText('Waiting for verification')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('labels the invalid count "Invalid" (M-8)', () => {
    render(<VerificationCard summary={{ configured: true, pending: 0, risky: 0, invalid: 1, pausedReason: null }} />)
    expect(screen.getByText('Invalid')).toBeInTheDocument()
    expect(screen.queryByText('Invalid (not emailed)')).not.toBeInTheDocument()
  })

  it('explains when verification is not configured', () => {
    render(<VerificationCard summary={{ configured: false, pending: 0, risky: 0, invalid: 0, pausedReason: null }} />)
    expect(screen.getByText(/Verification not configured/)).toBeInTheDocument()
  })

  it('shows a paused reason as an alert', () => {
    render(<VerificationCard summary={{ configured: true, pending: 5, risky: 0, invalid: 0, pausedReason: 'out of MillionVerifier credits' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Verification paused: out of MillionVerifier credits')
  })
})
