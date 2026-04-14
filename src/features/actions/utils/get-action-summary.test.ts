import { describe, it, expect } from 'vitest'
import { getActionSummary } from './get-action-summary'
import type { NextAction } from '../types'

function makeAction(type: NextAction['type'], id = '1'): NextAction {
  return {
    id: `${type}-${id}`,
    type,
    priority: 100,
    label: type,
    createdAt: new Date(),
  }
}

describe('getActionSummary', () => {
  it('returns "You\'re all caught up" for empty array', () => {
    expect(getActionSummary([])).toBe("You're all caught up")
  })

  it('returns single type summary', () => {
    const actions = [makeAction('REVIEW_REPLY', '1'), makeAction('REVIEW_REPLY', '2')]
    expect(getActionSummary(actions)).toBe('2 replies need review')
  })

  it('returns singular form for 1 item', () => {
    const actions = [makeAction('REVIEW_REPLY')]
    expect(getActionSummary(actions)).toBe('1 reply needs review')
  })

  it('joins multiple types with · separator', () => {
    const actions = [
      makeAction('REVIEW_REPLY', '1'),
      makeAction('APPROVE_DRAFT', '1'),
    ]
    const summary = getActionSummary(actions)
    expect(summary).toContain('·')
    expect(summary).toContain('reply')
    expect(summary).toContain('approval')
  })

  it('limits to top 3 categories', () => {
    const actions = [
      makeAction('REVIEW_REPLY', '1'),
      makeAction('APPROVE_DRAFT', '1'),
      makeAction('SEND_DRAFT', '1'),
      makeAction('FOLLOW_UP', '1'),
      makeAction('ENROLL_SEQUENCE', '1'),
    ]
    const summary = getActionSummary(actions)
    const parts = summary.split(' · ')
    expect(parts.length).toBeLessThanOrEqual(3)
  })

  it('prioritizes highest-priority types first', () => {
    const actions = [
      makeAction('ENROLL_SEQUENCE', '1'),
      makeAction('REVIEW_REPLY', '1'),
      makeAction('FOLLOW_UP', '1'),
    ]
    const summary = getActionSummary(actions)
    // REVIEW_REPLY should appear before FOLLOW_UP and ENROLL_SEQUENCE
    const replyIdx = summary.indexOf('reply')
    const followIdx = summary.indexOf('follow')
    expect(replyIdx).toBeLessThan(followIdx)
  })

  it('handles SEND_DRAFT correctly', () => {
    const actions = [makeAction('SEND_DRAFT', '1'), makeAction('SEND_DRAFT', '2')]
    expect(getActionSummary(actions)).toBe('2 drafts ready to send')
  })

  it('handles MARK_CONVERTED correctly', () => {
    const actions = [makeAction('MARK_CONVERTED')]
    expect(getActionSummary(actions)).toBe('1 lead ready to convert')
  })
})
