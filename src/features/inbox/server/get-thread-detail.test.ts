import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    outboundMessage: { findMany: vi.fn() },
    inboundReply: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getThreadDetail } from './get-thread-detail'

const mockLeadFind = prisma.lead.findFirst as ReturnType<typeof vi.fn>
const mockMsgFind = prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>
const mockReplyFind = prisma.inboundReply.findMany as ReturnType<typeof vi.fn>

const ORG = 'org-1'

beforeEach(() => { vi.resetAllMocks() })

describe('getThreadDetail', () => {
  it('throws if lead not found', async () => {
    mockLeadFind.mockResolvedValue(null)
    await expect(getThreadDetail({ organizationId: ORG, leadId: 'bad-id' })).rejects.toThrow('Lead not found')
  })

  it('merges outbound and inbound messages chronologically', async () => {
    mockLeadFind.mockResolvedValue({
      id: 'lead-1', email: 'alice@test.com', firstName: 'Alice', lastName: 'Smith',
      company: 'Acme', title: 'VP', status: 'REPLIED', score: 80,
    })
    mockMsgFind.mockResolvedValue([
      { id: 'msg-1', subject: 'Hello', body: 'Hi there', sentAt: new Date('2026-04-01'), status: 'SENT' },
    ])
    mockReplyFind.mockResolvedValue([
      { id: 'reply-1', rawBody: 'Thanks!', receivedAt: new Date('2026-04-02'), classification: 'POSITIVE', classificationConfidence: 0.95, isRead: true },
    ])

    const result = await getThreadDetail({ organizationId: ORG, leadId: 'lead-1' })
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0].direction).toBe('outbound')
    expect(result.messages[1].direction).toBe('inbound')
    expect(result.totalMessages).toBe(2)
  })

  it('returns empty messages when no activity', async () => {
    mockLeadFind.mockResolvedValue({
      id: 'lead-2', email: 'bob@test.com', firstName: null, lastName: null,
      company: null, title: null, status: 'NEW', score: null,
    })
    mockMsgFind.mockResolvedValue([])
    mockReplyFind.mockResolvedValue([])

    const result = await getThreadDetail({ organizationId: ORG, leadId: 'lead-2' })
    expect(result.messages).toEqual([])
  })
})
