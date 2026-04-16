import { describe, it, expect } from 'vitest'
import { groupTimelineItems } from './group-timeline-items'
import type { TimelineItem } from '../types'

function makeItem(daysAgo: number): TimelineItem {
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  return {
    id: `item-${daysAgo}-${Math.random()}`,
    type: 'EMAIL_SENT',
    description: 'test',
    timestamp: ts,
  }
}

describe('groupTimelineItems', () => {
  it('returns empty array for no items', () => {
    expect(groupTimelineItems([])).toEqual([])
  })

  it('groups today items under Today', () => {
    const items = [makeItem(0)]
    const groups = groupTimelineItems(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Today')
    expect(groups[0].items).toHaveLength(1)
  })

  it('groups yesterday items under Yesterday', () => {
    const items = [makeItem(1)]
    const groups = groupTimelineItems(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Yesterday')
  })

  it('groups older items under Earlier', () => {
    const items = [makeItem(5)]
    const groups = groupTimelineItems(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Earlier')
  })

  it('creates multiple groups in order', () => {
    const items = [makeItem(0), makeItem(1), makeItem(10)]
    const groups = groupTimelineItems(items)
    expect(groups).toHaveLength(3)
    expect(groups[0].label).toBe('Today')
    expect(groups[1].label).toBe('Yesterday')
    expect(groups[2].label).toBe('Earlier')
  })

  it('omits empty groups', () => {
    const items = [makeItem(0), makeItem(10)]
    const groups = groupTimelineItems(items)
    expect(groups).toHaveLength(2)
    expect(groups[0].label).toBe('Today')
    expect(groups[1].label).toBe('Earlier')
  })
})
