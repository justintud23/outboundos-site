// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LeadActionsPanel } from './lead-actions-panel'
import type { NextAction } from '@/features/actions/types'

function makeAction(overrides: Partial<NextAction> = {}): NextAction {
  return {
    id: 'action-1',
    type: 'APPROVE_DRAFT',
    priority: 90,
    label: 'Approve Draft',
    reason: 'Awaiting approval',
    leadId: 'lead-1',
    leadName: 'Jane',
    draftId: 'draft-1',
    createdAt: new Date('2025-01-15'),
    ...overrides,
  }
}

describe('LeadActionsPanel', () => {
  const mockOnExecute = vi.fn()
  const mockOnUndo = vi.fn()
  const defaults = {
    ghostIds: new Set<string>(),
    dismissedIds: new Set<string>(),
    errorActionId: null,
    errorMessage: null,
    onExecute: mockOnExecute,
    onUndo: mockOnUndo,
  }

  it('renders all actions in idle state', () => {
    const actions = [
      makeAction({ id: 'a1' }),
      makeAction({ id: 'a2', type: 'SEND_DRAFT', label: 'Send Draft', priority: 80 }),
    ]

    render(<LeadActionsPanel actions={actions} {...defaults} />)

    expect(screen.getByText('Approve Draft')).toBeDefined()
    expect(screen.getByText('Send Draft')).toBeDefined()
  })

  it('shows ghost state with undo for ghost action', () => {
    const actions = [makeAction({ id: 'a1' })]

    render(
      <LeadActionsPanel
        actions={actions}
        {...defaults}
        ghostIds={new Set(['a1'])}
      />,
    )

    expect(screen.getByText('Approved')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDefined()
  })

  it('applies dismiss animation to dismissed action', () => {
    const actions = [makeAction({ id: 'a1' })]

    const { container } = render(
      <LeadActionsPanel
        actions={actions}
        {...defaults}
        dismissedIds={new Set(['a1'])}
      />,
    )

    const actionRow = container.querySelector('.animate-dismiss')
    expect(actionRow).not.toBeNull()
  })

  it('shows error message and reverts to idle on error', () => {
    const actions = [makeAction({ id: 'a1' })]

    render(
      <LeadActionsPanel
        actions={actions}
        {...defaults}
        dismissedIds={new Set(['a1'])}
        errorActionId="a1"
        errorMessage="Draft not in pending review"
      />,
    )

    // Error message visible
    expect(screen.getByText('Draft not in pending review')).toBeDefined()
    // Action row should be back in idle (no dismiss animation)
    expect(screen.getByText('Approve Draft')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDefined()
  })

  it('does not apply dismiss animation when action has error', () => {
    const actions = [makeAction({ id: 'a1' })]

    const { container } = render(
      <LeadActionsPanel
        actions={actions}
        {...defaults}
        dismissedIds={new Set(['a1'])}
        errorActionId="a1"
        errorMessage="Some error"
      />,
    )

    const actionRow = container.querySelector('.animate-dismiss')
    expect(actionRow).toBeNull()
  })

  it('shows empty state when no actions', () => {
    render(<LeadActionsPanel actions={[]} {...defaults} />)

    expect(screen.getByText('All caught up')).toBeDefined()
  })

  it('undo button calls onUndo callback', () => {
    const action = makeAction({ id: 'a1' })

    render(
      <LeadActionsPanel
        actions={[action]}
        {...defaults}
        ghostIds={new Set(['a1'])}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(mockOnUndo).toHaveBeenCalledWith(action)
  })
})
