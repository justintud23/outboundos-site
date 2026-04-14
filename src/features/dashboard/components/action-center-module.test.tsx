// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActionCenterModule } from './action-center-module'
import type { NextAction } from '@/features/actions/types'

function makeAction(overrides: Partial<NextAction> & { id: string; type: NextAction['type'] }): NextAction {
  return {
    priority: 90,
    label: 'Test Action',
    createdAt: new Date('2026-04-14T10:00:00Z'),
    ...overrides,
  }
}

const sampleActions: NextAction[] = [
  makeAction({ id: 'a1', type: 'REVIEW_REPLY', label: 'Review Reply', leadName: 'Jane Doe', description: 'positive reply from Jane Doe', priority: 100 }),
  makeAction({ id: 'a2', type: 'APPROVE_DRAFT', label: 'Approve Draft', leadName: 'John Smith', description: '"Hello" for John Smith', priority: 90 }),
  makeAction({ id: 'a3', type: 'SEND_DRAFT', label: 'Send Draft', leadName: 'Alice', priority: 80 }),
  makeAction({ id: 'a4', type: 'FOLLOW_UP', label: 'Follow Up', leadName: 'Bob', priority: 70 }),
  makeAction({ id: 'a5', type: 'ENROLL_SEQUENCE', label: 'Enroll in Sequence', leadName: 'Eve', priority: 60 }),
]

describe('ActionCenterModule', () => {
  it('renders action items when actions exist', () => {
    render(<ActionCenterModule actions={sampleActions} />)
    expect(screen.getByText('Jane Doe')).toBeDefined()
    expect(screen.getByText('John Smith')).toBeDefined()
    expect(screen.getByText('Alice')).toBeDefined()
  })

  it('renders polished empty state when no actions', () => {
    render(<ActionCenterModule actions={[]} />)
    expect(screen.getByText("You're all caught up")).toBeDefined()
    expect(screen.getByText('No actions need attention right now')).toBeDefined()
  })

  it('does not render View All link when empty', () => {
    render(<ActionCenterModule actions={[]} />)
    expect(screen.queryByText('View all actions')).toBeNull()
  })

  it('renders View All link when actions exist', () => {
    render(<ActionCenterModule actions={sampleActions} />)
    const link = screen.getByText('View all actions')
    expect(link).toBeDefined()
    expect(link.closest('a')?.getAttribute('href')).toBe('/action-center')
  })

  it('renders all 5 action items', () => {
    render(<ActionCenterModule actions={sampleActions} />)
    expect(screen.getByText('Jane Doe')).toBeDefined()
    expect(screen.getByText('John Smith')).toBeDefined()
    expect(screen.getByText('Alice')).toBeDefined()
    expect(screen.getByText('Bob')).toBeDefined()
    expect(screen.getByText('Eve')).toBeDefined()
  })

  it('shows CTA buttons for each action', () => {
    render(<ActionCenterModule actions={[sampleActions[0]!]} />)
    expect(screen.getByText('Review')).toBeDefined()
  })
})
