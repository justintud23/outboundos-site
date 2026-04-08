import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findMany: vi.fn() },
    outboundMessage: { groupBy: vi.fn() },
    inboundReply: { groupBy: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getPipelineLeads } from './get-pipeline-leads'

const mockLeadFindMany = prisma.lead.findMany as ReturnType<typeof vi.fn>
const mockMessageGroupBy = prisma.outboundMessage.groupBy as ReturnType<typeof vi.fn>
const mockReplyGroupBy = prisma.inboundReply.groupBy as ReturnType<typeof vi.fn>

const ORG = 'org-1'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getPipelineLeads', () => {
  it('returns leads with computed lastActivityAt', async () => {
    const leadDate = new Date('2026-04-01T00:00:00Z')
    const msgDate = new Date('2026-04-05T00:00:00Z')
    const replyDate = new Date('2026-04-07T00:00:00Z')

    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@test.com',
      company: 'Acme',
      status: 'NEW',
      score: 80,
      updatedAt: leadDate,
    }])

    mockMessageGroupBy.mockResolvedValue([
      { leadId: 'lead-1', _max: { sentAt: msgDate } },
    ])

    mockReplyGroupBy.mockResolvedValue([
      { leadId: 'lead-1', _max: { receivedAt: replyDate } },
    ])

    const result = await getPipelineLeads({ organizationId: ORG })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('lead-1')
    expect(result[0].lastActivityAt).toEqual(replyDate)
  })

  it('uses lead.updatedAt as fallback when no messages or replies', async () => {
    const leadDate = new Date('2026-04-01T00:00:00Z')

    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-2',
      firstName: null,
      lastName: null,
      email: 'bob@test.com',
      company: null,
      status: 'NEW',
      score: null,
      updatedAt: leadDate,
    }])

    mockMessageGroupBy.mockResolvedValue([])
    mockReplyGroupBy.mockResolvedValue([])

    const result = await getPipelineLeads({ organizationId: ORG })

    expect(result[0].lastActivityAt).toEqual(leadDate)
  })

  it('returns empty array when no leads', async () => {
    mockLeadFindMany.mockResolvedValue([])

    const result = await getPipelineLeads({ organizationId: ORG })

    expect(result).toEqual([])
    expect(mockMessageGroupBy).not.toHaveBeenCalled()
    expect(mockReplyGroupBy).not.toHaveBeenCalled()
  })
})
