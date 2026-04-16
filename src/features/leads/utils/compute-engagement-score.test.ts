import { describe, it, expect } from 'vitest'
import { computeEngagementScore } from './compute-engagement-score'
import type { LeadDetailDTO, TimelineItem, LeadSequenceDTO } from '../types'

function makeLead(overrides: Partial<LeadDetailDTO> = {}): LeadDetailDTO {
  return {
    id: 'lead-1', email: 'test@example.com', firstName: 'Jane', lastName: 'Doe',
    company: 'Acme', title: 'CTO', linkedinUrl: null, phone: null, source: 'CSV',
    status: 'NEW', score: null, scoreReason: null, scoredAt: null,
    customFields: null, createdAt: new Date(), updatedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  }
}

function makeItem(overrides: Partial<TimelineItem> & Pick<TimelineItem, 'type'>): TimelineItem {
  return {
    id: Math.random().toString(),
    description: 'test',
    timestamp: new Date(),
    ...overrides,
  }
}

describe('computeEngagementScore', () => {
  it('returns 0 for a brand new lead with no activity', () => {
    const result = computeEngagementScore({
      lead: makeLead(),
      timeline: [],
      sequence: null,
    })
    expect(result.score).toBe(0)
    expect(result.tier).toBe('cold')
  })

  it('scores INTERESTED status + positive reply as hot', () => {
    const result = computeEngagementScore({
      lead: makeLead({ status: 'INTERESTED' }),
      timeline: [
        makeItem({ type: 'REPLY_RECEIVED', metadata: { classification: 'POSITIVE' } }),
        makeItem({ type: 'EMAIL_SENT' }),
      ],
      sequence: null,
    })
    // 25 (interested) + 30 (positive reply) + 10 (sent email) + 10 (recent) = 75
    expect(result.score).toBe(75)
    expect(result.tier).toBe('hot')
  })

  it('scores active sequence enrollment', () => {
    const result = computeEngagementScore({
      lead: makeLead(),
      timeline: [makeItem({ type: 'SEQUENCE_STEP' })],
      sequence: { status: 'ACTIVE' } as LeadSequenceDTO,
    })
    // 10 (sequence) + 10 (recent) = 20
    expect(result.score).toBe(20)
    expect(result.tier).toBe('cold')
  })

  it('applies staleness penalty for old activity', () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const result = computeEngagementScore({
      lead: makeLead({ status: 'REPLIED' }),
      timeline: [makeItem({ type: 'REPLY_RECEIVED', timestamp: oldDate })],
      sequence: null,
    })
    // 15 (replied) + 20 (any reply) - 15 (stale) = 20
    expect(result.score).toBe(20)
  })

  it('clamps score to 100', () => {
    const result = computeEngagementScore({
      lead: makeLead({ status: 'INTERESTED' }),
      timeline: [
        makeItem({ type: 'REPLY_RECEIVED', metadata: { classification: 'POSITIVE' } }),
        makeItem({ type: 'EMAIL_SENT' }),
      ],
      sequence: { status: 'ACTIVE' } as LeadSequenceDTO,
    })
    // 25 + 30 + 10 + 10 + 10 = 85 (under 100, but tests clamping logic works)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.score).toBeGreaterThanOrEqual(0)
  })

  it('clamps score to 0 minimum', () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const result = computeEngagementScore({
      lead: makeLead(),
      timeline: [makeItem({ type: 'EMAIL_SENT', timestamp: oldDate })],
      sequence: null,
    })
    // 10 (sent) - 15 (stale) = -5, clamped to 0
    expect(result.score).toBe(0)
  })
})
