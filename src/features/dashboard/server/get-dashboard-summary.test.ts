import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { count: vi.fn() },
    campaign: { count: vi.fn() },
    outboundMessage: { count: vi.fn() },
    inboundReply: { count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getDashboardSummary } from './get-dashboard-summary'

const mockLeadCount = prisma.lead.count as ReturnType<typeof vi.fn>
const mockCampaignCount = prisma.campaign.count as ReturnType<typeof vi.fn>
const mockMessageCount = prisma.outboundMessage.count as ReturnType<typeof vi.fn>
const mockReplyCount = prisma.inboundReply.count as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockLeadCount.mockResolvedValue(0)
  mockCampaignCount.mockResolvedValue(0)
  mockMessageCount.mockResolvedValue(0)
  mockReplyCount.mockResolvedValue(0)
})

describe('getDashboardSummary', () => {
  it('returns counts scoped to the organization when ownerId is absent', async () => {
    await getDashboardSummary({ organizationId: 'org-1' })

    expect(mockLeadCount).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } })
    expect(mockCampaignCount).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } })
    expect(mockMessageCount).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } })
    expect(mockReplyCount).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } })
    expect(mockReplyCount).toHaveBeenCalledWith({ where: { organizationId: 'org-1', classification: 'POSITIVE' } })
  })

  it('filters all counts by ownerId when provided: leads/campaigns directly, messages/replies via lead.ownerId', async () => {
    await getDashboardSummary({ organizationId: 'org-1', ownerId: 'm1' })

    expect(mockLeadCount).toHaveBeenCalledWith({ where: { organizationId: 'org-1', ownerId: 'm1' } })
    expect(mockCampaignCount).toHaveBeenCalledWith({ where: { organizationId: 'org-1', ownerId: 'm1' } })
    expect(mockMessageCount).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', lead: { ownerId: 'm1' } },
    })
    expect(mockReplyCount).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', lead: { ownerId: 'm1' } },
    })
    expect(mockReplyCount).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', classification: 'POSITIVE', lead: { ownerId: 'm1' } },
    })
  })

  it('returns the DTO shape', async () => {
    mockLeadCount.mockResolvedValue(10)
    mockCampaignCount.mockResolvedValue(2)
    mockMessageCount.mockResolvedValue(50)
    mockReplyCount.mockResolvedValueOnce(8).mockResolvedValueOnce(3)

    const result = await getDashboardSummary({ organizationId: 'org-1' })

    expect(result).toEqual({ leads: 10, campaigns: 2, messagesSent: 50, replies: 8, positiveReplies: 3 })
  })
})
