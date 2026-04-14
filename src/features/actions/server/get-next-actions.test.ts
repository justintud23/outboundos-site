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

const fakeLead = { id: 'lead-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe' }
const now = new Date('2026-04-14T10:00:00Z')
const earlier = new Date('2026-04-14T09:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  // Default: all queries return empty
  mockPrisma.draft.findMany.mockResolvedValue([])
  mockPrisma.inboundReply.findMany.mockResolvedValue([])
  mockPrisma.lead.findMany.mockResolvedValue([])
})

describe('getNextActions', () => {
  it('returns empty array when no data exists', async () => {
    const result = await getNextActions({ organizationId: ORG_ID })
    expect(result).toEqual([])
  })

  it('creates APPROVE_DRAFT actions from pending drafts', async () => {
    mockPrisma.draft.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'PENDING_REVIEW') {
        return [{ id: 'draft-1', subject: 'Hello', createdAt: now, lead: fakeLead }]
      }
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const approveDrafts = result.filter((a) => a.type === 'APPROVE_DRAFT')

    expect(approveDrafts).toHaveLength(1)
    expect(approveDrafts[0]!.draftId).toBe('draft-1')
    expect(approveDrafts[0]!.leadName).toBe('Jane Doe')
    expect(approveDrafts[0]!.priority).toBe(90)
  })

  it('creates SEND_DRAFT actions from approved unsent drafts', async () => {
    mockPrisma.draft.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'APPROVED') {
        return [{ id: 'draft-2', subject: 'Follow up', createdAt: now, lead: fakeLead }]
      }
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const sendDrafts = result.filter((a) => a.type === 'SEND_DRAFT')

    expect(sendDrafts).toHaveLength(1)
    expect(sendDrafts[0]!.draftId).toBe('draft-2')
    expect(sendDrafts[0]!.priority).toBe(80)
  })

  it('creates REVIEW_REPLY actions from unread replies', async () => {
    mockPrisma.inboundReply.findMany.mockResolvedValue([
      { id: 'reply-1', receivedAt: now, classification: 'POSITIVE', lead: fakeLead },
    ])

    const result = await getNextActions({ organizationId: ORG_ID })
    const reviewReplies = result.filter((a) => a.type === 'REVIEW_REPLY')

    expect(reviewReplies).toHaveLength(1)
    expect(reviewReplies[0]!.replyId).toBe('reply-1')
    expect(reviewReplies[0]!.priority).toBe(100)
  })

  it('creates ENROLL_SEQUENCE actions for new leads without enrollment', async () => {
    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'NEW') {
        return [{ ...fakeLead, createdAt: now }]
      }
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const enrolls = result.filter((a) => a.type === 'ENROLL_SEQUENCE')

    expect(enrolls).toHaveLength(1)
    expect(enrolls[0]!.leadId).toBe('lead-1')
    expect(enrolls[0]!.priority).toBe(60)
  })

  it('creates FOLLOW_UP actions for replied leads without draft', async () => {
    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'REPLIED') {
        return [{ ...fakeLead, updatedAt: now }]
      }
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const followUps = result.filter((a) => a.type === 'FOLLOW_UP')

    expect(followUps).toHaveLength(1)
    expect(followUps[0]!.priority).toBe(70)
  })

  it('creates both REVIEW_INTERESTED_LEAD and MARK_CONVERTED for interested leads', async () => {
    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'INTERESTED') {
        return [{ ...fakeLead, updatedAt: now }]
      }
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    const reviewInterested = result.filter((a) => a.type === 'REVIEW_INTERESTED_LEAD')
    const markConverted = result.filter((a) => a.type === 'MARK_CONVERTED')

    expect(reviewInterested).toHaveLength(1)
    expect(reviewInterested[0]!.priority).toBe(55)
    expect(markConverted).toHaveLength(1)
    expect(markConverted[0]!.priority).toBe(50)
  })

  it('sorts by priority DESC, then createdAt DESC', async () => {
    // Reply (p100) + Pending draft (p90) + Follow up (p70)
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
      if (args.where.status === 'REPLIED') {
        return [{ ...fakeLead, updatedAt: now }]
      }
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })

    expect(result[0]!.type).toBe('REVIEW_REPLY')
    expect(result[1]!.type).toBe('APPROVE_DRAFT')
    expect(result[2]!.type).toBe('FOLLOW_UP')
  })

  it('respects limit parameter', async () => {
    // Generate many leads
    const manyLeads = Array.from({ length: 20 }, (_, i) => ({
      id: `lead-${i}`,
      email: `lead${i}@test.com`,
      firstName: `Lead`,
      lastName: `${i}`,
      createdAt: now,
    }))

    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'NEW') return manyLeads
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID, limit: 5 })
    expect(result).toHaveLength(5)
  })

  it('defaults limit to 15', async () => {
    const manyLeads = Array.from({ length: 20 }, (_, i) => ({
      id: `lead-${i}`,
      email: `lead${i}@test.com`,
      firstName: `Lead`,
      lastName: `${i}`,
      createdAt: now,
    }))

    mockPrisma.lead.findMany.mockImplementation(async (args: { where: { status?: string } }) => {
      if (args.where.status === 'NEW') return manyLeads
      return []
    })

    const result = await getNextActions({ organizationId: ORG_ID })
    expect(result).toHaveLength(15)
  })

  it('passes organizationId to all queries', async () => {
    await getNextActions({ organizationId: ORG_ID })

    // Drafts queries (2 calls: pending + approved)
    for (const call of mockPrisma.draft.findMany.mock.calls) {
      expect(call[0].where.organizationId).toBe(ORG_ID)
    }
    // Replies query
    for (const call of mockPrisma.inboundReply.findMany.mock.calls) {
      expect(call[0].where.organizationId).toBe(ORG_ID)
    }
    // Lead queries (3 calls: NEW, REPLIED, INTERESTED)
    for (const call of mockPrisma.lead.findMany.mock.calls) {
      expect(call[0].where.organizationId).toBe(ORG_ID)
    }
  })

  it('uses lead email as fallback name when name is null', async () => {
    const noNameLead = { id: 'lead-x', email: 'anon@test.com', firstName: null, lastName: null }
    mockPrisma.inboundReply.findMany.mockResolvedValue([
      { id: 'reply-x', receivedAt: now, classification: 'POSITIVE', lead: noNameLead },
    ])

    const result = await getNextActions({ organizationId: ORG_ID })

    expect(result[0]!.leadName).toBe('anon@test.com')
  })

  it('includes id field on every action', async () => {
    mockPrisma.inboundReply.findMany.mockResolvedValue([
      { id: 'reply-1', receivedAt: now, classification: 'POSITIVE', lead: fakeLead },
    ])

    const result = await getNextActions({ organizationId: ORG_ID })

    for (const action of result) {
      expect(action.id).toBeDefined()
      expect(typeof action.id).toBe('string')
      expect(action.id.length).toBeGreaterThan(0)
    }
  })
})
