// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InlineActionItem, isInlineAction, executeAction } from './inline-action-item'
import type { NextAction } from '@/features/actions/types'

function makeAction(overrides: Partial<NextAction> = {}): NextAction {
  return {
    id: 'action-1',
    type: 'APPROVE_DRAFT',
    priority: 90,
    label: 'Approve Draft',
    description: '"Welcome" for Jane Doe',
    reason: 'Created 2h ago — awaiting approval',
    leadId: 'lead-1',
    leadName: 'Jane Doe',
    draftId: 'draft-1',
    createdAt: new Date('2025-01-15'),
    ...overrides,
  }
}

describe('isInlineAction', () => {
  it('returns true for supported types', () => {
    expect(isInlineAction('APPROVE_DRAFT')).toBe(true)
    expect(isInlineAction('SEND_DRAFT')).toBe(true)
    expect(isInlineAction('MARK_CONVERTED')).toBe(true)
  })

  it('returns false for unsupported types', () => {
    expect(isInlineAction('REVIEW_REPLY')).toBe(false)
    expect(isInlineAction('FOLLOW_UP')).toBe(false)
    expect(isInlineAction('ENROLL_SEQUENCE')).toBe(false)
  })
})

describe('executeAction', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls approve API for APPROVE_DRAFT', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', mockFetch)

    await executeAction(makeAction())

    expect(mockFetch).toHaveBeenCalledWith('/api/drafts/draft-1/review', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
  })

  it('calls send API for SEND_DRAFT', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', mockFetch)

    await executeAction(makeAction({ type: 'SEND_DRAFT', priority: 80 }))

    expect(mockFetch).toHaveBeenCalledWith('/api/drafts/draft-1/send', {
      method: 'POST',
    })
  })

  it('calls status API for MARK_CONVERTED', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', mockFetch)

    await executeAction(makeAction({ type: 'MARK_CONVERTED', priority: 50, draftId: undefined }))

    expect(mockFetch).toHaveBeenCalledWith('/api/leads/lead-1/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CONVERTED' }),
    })
  })

  it('throws on API error with server message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Draft not in pending review' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await expect(executeAction(makeAction())).rejects.toThrow('Draft not in pending review')
  })
})

describe('InlineActionItem', () => {
  const mockOnExecute = vi.fn()
  const mockOnUndo = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders action label and CTA in idle phase', () => {
    render(
      <InlineActionItem action={makeAction()} phase="idle" onExecute={mockOnExecute} onUndo={mockOnUndo} />,
    )

    expect(screen.getByText('Approve Draft')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined()
  })

  it('calls onExecute when CTA is clicked', () => {
    const action = makeAction()
    render(
      <InlineActionItem action={action} phase="idle" onExecute={mockOnExecute} onUndo={mockOnUndo} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(mockOnExecute).toHaveBeenCalledWith(action)
  })

  it('shows ghost state with success label and undo button', () => {
    render(
      <InlineActionItem action={makeAction()} phase="ghost" onExecute={mockOnExecute} onUndo={mockOnUndo} />,
    )

    expect(screen.getByText('Approved')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDefined()
    // CTA should not be visible
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('calls onUndo when undo button is clicked in ghost state', () => {
    const action = makeAction()
    render(
      <InlineActionItem action={action} phase="ghost" onExecute={mockOnExecute} onUndo={mockOnUndo} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(mockOnUndo).toHaveBeenCalledWith(action)
  })

  it('applies dismiss animation in dismissing phase', () => {
    const { container } = render(
      <InlineActionItem action={makeAction()} phase="dismissing" onExecute={mockOnExecute} onUndo={mockOnUndo} />,
    )

    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('animate-dismiss')
    expect(row.className).toContain('pointer-events-none')
  })

  it('shows reduced opacity in ghost phase', () => {
    const { container } = render(
      <InlineActionItem action={makeAction()} phase="ghost" onExecute={mockOnExecute} onUndo={mockOnUndo} />,
    )

    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('opacity-75')
  })

  it('does not show CTA button in dismissing phase', () => {
    render(
      <InlineActionItem action={makeAction()} phase="dismissing" onExecute={mockOnExecute} onUndo={mockOnUndo} />,
    )

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('shows correct success label for SEND_DRAFT', () => {
    render(
      <InlineActionItem
        action={makeAction({ type: 'SEND_DRAFT', label: 'Send Draft' })}
        phase="ghost"
        onExecute={mockOnExecute}
        onUndo={mockOnUndo}
      />,
    )

    expect(screen.getByText('Sent')).toBeDefined()
  })

  it('shows correct success label for MARK_CONVERTED', () => {
    render(
      <InlineActionItem
        action={makeAction({ type: 'MARK_CONVERTED', label: 'Mark Converted' })}
        phase="ghost"
        onExecute={mockOnExecute}
        onUndo={mockOnUndo}
      />,
    )

    expect(screen.getByText('Converted')).toBeDefined()
  })
})
