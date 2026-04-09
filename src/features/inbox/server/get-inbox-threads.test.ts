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
})
