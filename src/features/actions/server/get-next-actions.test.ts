import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: { findMany: vi.fn() },
    inboundReply: { findMany: vi.fn() },
    lead: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getNextActions } from './get-next-actions'

const mockPrisma = prisma as unknown as {
  draft: { findMany: ReturnType<typeof vi.fn> }
  inboundReply: { findMany: ReturnType<typeof vi.fn> }
  lead: { findMany: ReturnType<typeof vi.fn> }
}

const ORG_ID = 'org-test-1'

const fakeLead = { id: 'lead-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe', company: 'Acme' }
const now = new Date('2026-04-14T10:00:00Z')
const earlier = new Date('2026-04-14T09:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.draft.findMany.mockResolvedValue([])
  mockPrisma.inboundReply.findMany.mockResolvedValue([])
  mockPrisma.lead.findMany.mockResolvedValue([])
})

describe('getNextActions', () => {
  it('returns empty array when no data exists', async () => {
    const result = await getNextActions({ organizationId: ORG_ID })
    expect(result).toEqual([])
  })

  it('creates APPROVE_DRAFT with tight reason wording', async () => {
    mockPrisma.draft.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'PENDING_REVIEW') {
        return [{ id: 'draft-1', subject: 'Hello', createdAt: now, lead: fakeLead }]
      }
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const action = result.find((a) => a.type === 'APPROVE_DRAFT')!

    expect(action.draftId).toBe('draft-1')
    expect(action.priority).toBe(90)
    expect(action.description).toContain('Acme')
    expect(action.reason).toContain('awaiting approval')
    expect(action.reason!.length).toBeLessThan(60)
  })

  it('creates SEND_DRAFT with approval time in reason', async () => {
    const approvedAt = new Date('2026-04-14T09:30:00Z')
    mockPrisma.draft.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'APPROVED') {
        return [{ id: 'draft-2', subject: 'Follow up', createdAt: now, approvedAt, lead: fakeLead }]
      }
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const action = result.find((a) => a.type === 'SEND_DRAFT')!

    expect(action.reason).toContain('Approved')
    expect(action.reason).toContain('ready to send')
  })

  it('creates REVIEW_REPLY with time-decay urgency suffix', async () => {
    // Reply from 30 minutes ago → "respond promptly"
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000)
    mockPrisma.inboundReply.findMany.mockResolvedValue([
      { id: 'reply-1', receivedAt: thirtyMinAgo, classification: 'POSITIVE', lead: fakeLead },
    ])

    const result = await getNextActions({ organizationId: ORG_ID })
    const action = result.find((a) => a.type === 'REVIEW_REPLY')!

    expect(action.reason).toContain('Received')
    expect(action.reason).toContain('respond promptly')
  })

  it('uses "follow up soon" for replies 1-24h old', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000)
    mockPrisma.inboundReply.findMany.mockResolvedValue([
      { id: 'reply-2', receivedAt: threeHoursAgo, classification: 'NEUTRAL', lead: fakeLead },
    ])

    const result = await getNextActions({ organizationId: ORG_ID })
    const action = result.find((a) => a.type === 'REVIEW_REPLY')!

    expect(action.reason).toContain('follow up soon')
  })

  it('uses "urgency decreasing" for replies > 24h old', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000)
    mockPrisma.inboundReply.findMany.mockResolvedValue([
      { id: 'reply-3', receivedAt: twoDaysAgo, classification: 'POSITIVE', lead: fakeLead },
    ])

    const result = await getNextActions({ organizationId: ORG_ID })
    const action = result.find((a) => a.type === 'REVIEW_REPLY')!

    expect(action.reason).toContain('urgency decreasing')
  })

  it('creates ENROLL_SEQUENCE with tight reason', async () => {
    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'NEW') return [{ ...fakeLead, createdAt: now }]
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const action = result.find((a) => a.type === 'ENROLL_SEQUENCE')!

    expect(action.reason).toContain('not enrolled')
  })

  it('creates FOLLOW_UP with time-decay urgency', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000)
    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'REPLIED') return [{ ...fakeLead, updatedAt: fiveHoursAgo }]
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const action = result.find((a) => a.type === 'FOLLOW_UP')!

    expect(action.reason).toContain('Replied')
    expect(action.reason).toContain('follow up soon')
  })

  it('creates REVIEW_INTERESTED_LEAD with tight reason', async () => {
    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'INTERESTED') return [{ ...fakeLead, updatedAt: now }]
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const review = result.find((a) => a.type === 'REVIEW_INTERESTED_LEAD')!
    const convert = result.find((a) => a.type === 'MARK_CONVERTED')!

    expect(review.reason).toContain('review engagement')
    expect(convert.reason).toContain('ready to convert')
  })

  it('sorts by priority DESC, then createdAt DESC', async () => {
    mockPrisma.inboundReply.findMany.mockResolvedValue([
      { id: 'reply-1', receivedAt: earlier, classification: 'NEUTRAL', lead: fakeLead },
    ])
    mockPrisma.draft.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'PENDING_REVIEW') {
        return [{ id: 'draft-1', subject: 'Hi', createdAt: now, lead: fakeLead }]
      }
      return []
    })
    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'REPLIED') return [{ ...fakeLead, updatedAt: now }]
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })

    expect(result[0]!.type).toBe('REVIEW_REPLY')
    expect(result[1]!.type).toBe('APPROVE_DRAFT')
    expect(result[2]!.type).toBe('FOLLOW_UP')
  })

  it('respects limit parameter', async () => {
    const manyLeads = Array.from({ length: 20 }, (_, i) => ({
      id: `lead-${i}`, email: `lead${i}@test.com`, firstName: 'Lead', lastName: `${i}`, company: null, createdAt: now,
    }))
    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'NEW') return manyLeads
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID, limit: 5 })
    expect(result).toHaveLength(5)
  })

  it('passes organizationId to all queries', async () => {
    await getNextActions({ organizationId: ORG_ID })

    for (const call of mockPrisma.draft.findMany.mock.calls) {
      expect(call[0].where.organizationId).toBe(ORG_ID)
    }
    for (const call of mockPrisma.inboundReply.findMany.mock.calls) {
      expect(call[0].where.organizationId).toBe(ORG_ID)
    }
    for (const call of mockPrisma.lead.findMany.mock.calls) {
      expect(call[0].where.organizationId).toBe(ORG_ID)
    }
  })

  it('includes id and reason fields on every action', async () => {
    mockPrisma.inboundReply.findMany.mockResolvedValue([
      { id: 'reply-1', receivedAt: now, classification: 'POSITIVE', lead: fakeLead },
    ])

    const result = await getNextActions({ organizationId: ORG_ID })

    for (const action of result) {
      expect(action.id).toBeDefined()
      expect(typeof action.id).toBe('string')
      expect(action.reason).toBeDefined()
      expect(action.reason!.length).toBeGreaterThan(0)
    }
  })
})
