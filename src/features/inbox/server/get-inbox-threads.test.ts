import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { groupBy: vi.fn() },
    inboundReply: { groupBy: vi.fn(), findMany: vi.fn() },
    lead: { findMany: vi.fn(), count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getInboxThreads } from './get-inbox-threads'

const mockMsgGroupBy = prisma.outboundMessage.groupBy as ReturnType<typeof vi.fn>
const mockReplyGroupBy = prisma.inboundReply.groupBy as ReturnType<typeof vi.fn>
const mockReplyFindMany = prisma.inboundReply.findMany as ReturnType<typeof vi.fn>
const mockLeadFindMany = prisma.lead.findMany as ReturnType<typeof vi.fn>
const mockLeadCount = prisma.lead.count as ReturnType<typeof vi.fn>

const ORG = 'org-1'

beforeEach(() => { vi.resetAllMocks() })

describe('getInboxThreads', () => {
  it('returns threads with lastActivityAt from latest activity', async () => {
    const msgDate = new Date('2026-04-05T00:00:00Z')
    const replyDate = new Date('2026-04-07T00:00:00Z')

    mockMsgGroupBy.mockResolvedValue([
      { leadId: 'lead-1', _max: { sentAt: msgDate }, _count: { _all: 2 } },
    ])
    mockReplyGroupBy.mockResolvedValue([
      { leadId: 'lead-1', _max: { receivedAt: replyDate }, _count: { _all: 1 } },
    ])
    // Unread counts query
    mockReplyGroupBy.mockResolvedValueOnce([
      { leadId: 'lead-1', _max: { receivedAt: replyDate }, _count: { _all: 1 } },
    ])
    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1', email: 'alice@test.com', firstName: 'Alice', lastName: 'Smith',
      company: 'Acme', status: 'REPLIED',
    }])
    mockLeadCount.mockResolvedValue(1)
    mockReplyFindMany.mockResolvedValue([
      { leadId: 'lead-1', rawBody: 'Thanks for reaching out!', classification: 'POSITIVE', isRead: false },
    ])

    const result = await getInboxThreads({ organizationId: ORG })

    expect(result.threads).toHaveLength(1)
    expect(result.threads[0].lastActivityAt).toEqual(replyDate)
    expect(result.threads[0].leadName).toBe('Alice Smith')
  })

  it('returns empty when no activity', async () => {
    mockMsgGroupBy.mockResolvedValue([])
    mockReplyGroupBy.mockResolvedValue([])

    const result = await getInboxThreads({ organizationId: ORG })
    expect(result.threads).toEqual([])
    expect(result.total).toBe(0)
  })

  describe('owner filter', () => {
    it('filters leads by ownerId when provided', async () => {
      mockMsgGroupBy.mockResolvedValue([
        { leadId: 'lead-1', _max: { sentAt: new Date('2026-04-05T00:00:00Z') }, _count: { _all: 1 } },
      ])
      mockReplyGroupBy.mockResolvedValue([])
      mockLeadFindMany.mockResolvedValue([])

      await getInboxThreads({ organizationId: ORG, ownerId: 'm1' })

      expect(mockLeadFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['lead-1'] }, organizationId: ORG, ownerId: 'm1' },
        }),
      )
    })

    it('leaves the lead where clause unchanged when ownerId is absent', async () => {
      mockMsgGroupBy.mockResolvedValue([
        { leadId: 'lead-1', _max: { sentAt: new Date('2026-04-05T00:00:00Z') }, _count: { _all: 1 } },
      ])
      mockReplyGroupBy.mockResolvedValue([])
      mockLeadFindMany.mockResolvedValue([])

      await getInboxThreads({ organizationId: ORG })

      expect(mockLeadFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['lead-1'] }, organizationId: ORG },
        }),
      )
    })
  })

  describe('ownerName', () => {
    it('maps ownerName from owner.name, falling back to owner.email, or null', async () => {
      const msgDate = new Date('2026-04-05T00:00:00Z')
      mockMsgGroupBy.mockResolvedValue([
        { leadId: 'a', _max: { sentAt: msgDate }, _count: { _all: 1 } },
        { leadId: 'b', _max: { sentAt: msgDate }, _count: { _all: 1 } },
        { leadId: 'c', _max: { sentAt: msgDate }, _count: { _all: 1 } },
      ])
      mockReplyGroupBy.mockResolvedValue([])
      mockLeadFindMany.mockResolvedValue([
        { id: 'a', email: 'a@x.com', firstName: null, lastName: null, company: null, status: 'NEW', owner: { name: 'Alice', email: 'alice@acme.com' } },
        { id: 'b', email: 'b@x.com', firstName: null, lastName: null, company: null, status: 'NEW', owner: { name: null, email: 'bob@acme.com' } },
        { id: 'c', email: 'c@x.com', firstName: null, lastName: null, company: null, status: 'NEW', owner: null },
      ])
      mockReplyFindMany.mockResolvedValue([])

      const { threads } = await getInboxThreads({ organizationId: ORG })

      const byLead = new Map(threads.map((t) => [t.leadId, t.ownerName]))
      expect(byLead.get('a')).toBe('Alice')
      expect(byLead.get('b')).toBe('bob@acme.com')
      expect(byLead.get('c')).toBeNull()
    })
  })
})
