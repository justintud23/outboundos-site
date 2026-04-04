// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DraftReviewDrawer } from './draft-review-drawer'
import type { DraftWithLeadDTO } from '@/features/drafts/types'

function makeDraft(overrides: Partial<DraftWithLeadDTO> = {}): DraftWithLeadDTO {
  return {
    id:                 'draft-1',
    organizationId:     'org-1',
    leadId:             'lead-1',
    subject:            'Cold outreach — Q2',
    body:               'Hi Jane, reaching out because...',
    status:             'PENDING_REVIEW',
    promptTemplateId:   overrides.promptTemplateId ?? null,
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
      company:   'Acme Corp',
    },
    ...overrides,
  }
}

describe('DraftReviewDrawer', () => {
  it('renders nothing when draft is null', () => {
    const { container } = render(
      <DraftReviewDrawer draft={null} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the drawer when a draft is provided', () => {
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('Review Draft')).toBeDefined()
  })

  it('shows lead name and email in the To section', () => {
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    expect(screen.getByText('Jane Doe')).toBeDefined()
    expect(screen.getByText('jane@acme.com')).toBeDefined()
  })

  it('shows lead company when available', () => {
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    expect(screen.getByText('Acme Corp')).toBeDefined()
  })

  it('shows AI Generated indicator when promptTemplateId is set', () => {
    render(
      <DraftReviewDrawer
        draft={makeDraft({ promptTemplateId: 'tmpl-1' })}
        onClose={vi.fn()}
        onReviewed={vi.fn()}
      />,
    )
    expect(screen.getByText(/AI Generated/)).toBeDefined()
  })

  it('does not show AI Generated indicator when promptTemplateId is null', () => {
    render(
      <DraftReviewDrawer
        draft={makeDraft({ promptTemplateId: null })}
        onClose={vi.fn()}
        onReviewed={vi.fn()}
      />,
    )
    expect(screen.queryByText(/AI Generated/)).toBeNull()
  })

  it('pre-fills the subject input with draft subject', () => {
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    const input = screen.getByLabelText(/subject/i) as HTMLInputElement
    expect(input.value).toBe('Cold outreach — Q2')
  })

  it('pre-fills the body textarea with draft body', () => {
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    const textarea = screen.getByLabelText(/body/i) as HTMLTextAreaElement
    expect(textarea.value).toBe('Hi Jane, reaching out because...')
  })

  it('shows Approve and Reject buttons initially', () => {
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /approve/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /reject/i })).toBeDefined()
  })

  it('shows rejection reason input after clicking Reject', () => {
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }))
    expect(screen.getByLabelText(/rejection reason/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /confirm reject/i })).toBeDefined()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={onClose} onReviewed={vi.fn()} />,
    )
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows edited indicator when subject is changed', () => {
    render(
      <DraftReviewDrawer draft={makeDraft()} onClose={vi.fn()} onReviewed={vi.fn()} />,
    )
    const input = screen.getByLabelText(/subject/i)
    fireEvent.change(input, { target: { value: 'New subject' } })
    expect(screen.getByText(/edited.*will save on approve/i)).toBeDefined()
  })
})
