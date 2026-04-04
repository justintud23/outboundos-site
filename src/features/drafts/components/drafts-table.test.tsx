// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DraftsTable } from './drafts-table'
import type { DraftWithLeadDTO } from '@/features/drafts/types'

function makeDraft(overrides: Partial<DraftWithLeadDTO> = {}): DraftWithLeadDTO {
  return {
    id:                 overrides.id          ?? 'draft-1',
    organizationId:     'org-1',
    leadId:             'lead-1',
    subject:            overrides.subject      ?? 'Hello from OutboundOS',
    body:               'Hi Jane, ...',
    status:             overrides.status       ?? 'PENDING_REVIEW',
    promptTemplateId:   null,
    createdByClerkId:   'user-1',
    approvedByClerkId:  null,
    approvedAt:         null,
    rejectedAt:         null,
    rejectionReason:    null,
    createdAt:          new Date('2026-03-01'),
    updatedAt:          new Date('2026-03-01'),
    lead: {
      id:        'lead-1',
      email:     'jane@acme.com',
      firstName: 'Jane',
      lastName:  'Doe',
      company:   'Acme',
      ...overrides.lead,
    },
  }
}

describe('DraftsTable', () => {
  it('renders the empty state when no drafts', () => {
    render(<DraftsTable drafts={[]} onReview={vi.fn()} />)
    expect(screen.getByText('No drafts to review.')).toBeDefined()
  })

  it('renders lead name and email', () => {
    render(<DraftsTable drafts={[makeDraft()]} onReview={vi.fn()} />)
    expect(screen.getByText('Jane Doe')).toBeDefined()
    expect(screen.getByText('jane@acme.com')).toBeDefined()
  })

  it('renders the subject', () => {
    render(<DraftsTable drafts={[makeDraft()]} onReview={vi.fn()} />)
    expect(screen.getByText('Hello from OutboundOS')).toBeDefined()
  })

  it('renders amber "Pending Review" badge for PENDING_REVIEW status', () => {
    render(<DraftsTable drafts={[makeDraft({ status: 'PENDING_REVIEW' })]} onReview={vi.fn()} />)
    expect(screen.getByText('Pending Review')).toBeDefined()
  })

  it('renders green "Approved" badge for APPROVED status', () => {
    render(<DraftsTable drafts={[makeDraft({ status: 'APPROVED' })]} onReview={vi.fn()} />)
    expect(screen.getByText('Approved')).toBeDefined()
  })

  it('renders red "Rejected" badge for REJECTED status', () => {
    render(<DraftsTable drafts={[makeDraft({ status: 'REJECTED' })]} onReview={vi.fn()} />)
    expect(screen.getByText('Rejected')).toBeDefined()
  })

  it('shows Review button only for PENDING_REVIEW drafts', () => {
    render(<DraftsTable drafts={[makeDraft({ status: 'PENDING_REVIEW' })]} onReview={vi.fn()} />)
    expect(screen.getByRole('button', { name: /review/i })).toBeDefined()
  })

  it('does not show Review button for APPROVED drafts', () => {
    render(<DraftsTable drafts={[makeDraft({ status: 'APPROVED' })]} onReview={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /review/i })).toBeNull()
  })

  it('calls onReview with the draft when Review is clicked', () => {
    const onReview = vi.fn()
    const draft = makeDraft()
    render(<DraftsTable drafts={[draft]} onReview={onReview} />)
    fireEvent.click(screen.getByRole('button', { name: /review/i }))
    expect(onReview).toHaveBeenCalledWith(draft)
  })

  it('shows Send button for APPROVED drafts when onSend is provided', () => {
    const draft = makeDraft({ status: 'APPROVED' })
    render(<DraftsTable drafts={[draft]} onReview={vi.fn()} onSend={vi.fn()} />)
    expect(screen.getByRole('button', { name: /send/i })).toBeDefined()
  })

  it('falls back to email when lead has no name', () => {
    const draft = makeDraft({ lead: { id: 'l1', email: 'anon@co.com', firstName: null, lastName: null, company: null } })
    render(<DraftsTable drafts={[draft]} onReview={vi.fn()} />)
    expect(screen.getAllByText('anon@co.com')).toBeDefined()
  })
})
