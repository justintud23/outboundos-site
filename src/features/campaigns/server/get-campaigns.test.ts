import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    campaign:      { findMany: vi.fn() },
    draft:         { groupBy: vi.fn() },
    inboundReply:  { count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getCampaigns } from './get-campaigns'

const mockFindMany     = prisma.campaign.findMany     as ReturnType<typeof vi.fn>
const mockGroupBy      = prisma.draft.groupBy         as ReturnType<typeof vi.fn>
const mockReplyCount   = prisma.inboundReply.count    as ReturnType<typeof vi.fn>

function makeCampaignRow(overrides: Partial<{
  id: string
  name: string
  description: string | null
  status: string
  createdAt: Date
  _count: { outboundMessages: number; drafts: number }
}> = {}) {
  return {
    id:          overrides.id          ?? 'campaign-1',
    name:        overrides.name        ?? 'Test Campaign',
    description: overrides.description ?? null,
    status:      overrides.status      ?? 'ACTIVE',
    createdAt:   overrides.createdAt   ?? new Date('2026-01-01'),
    _count: {
      outboundMessages: overrides._count?.outboundMessages ?? 0,
      drafts:           overrides._count?.drafts           ?? 0,
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('getCampaigns', () => {
  it('returns campaigns with correct aggregated counts including replyCount', async () => {
    mockFindMany.mockResolvedValue([
      makeCampaignRow({
        id: 'c1',
        name: 'Q2 Blitz',
        status: 'ACTIVE',
        _count: { outboundMessages: 12, drafts: 4 },
      }),
    ])
    mockGroupBy
      .mockResolvedValueOnce([{ campaignId: 'c1', _count: { _all: 3 } }]) // pending
      .mockResolvedValueOnce([{ campaignId: 'c1', _count: { _all: 1 } }]) // approved
    mockReplyCount.mockResolvedValueOnce(5)

    const { campaigns, total } = await getCampaigns({ organizationId: 'org-1' })

    expect(total).toBe(1)
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0]).toMatchObject({
      id:                 'c1',
      name:               'Q2 Blitz',
      status:             'ACTIVE',
      messageCount:       12,
      draftPendingCount:  3,
      draftApprovedCount: 1,
      replyCount:         5,
    })
  })

  it('scopes all queries to the provided organizationId', async () => {
    mockFindMany.mockResolvedValue([
      makeCampaignRow({ id: 'c1' }),
    ])
    mockGroupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mockReplyCount.mockResolvedValueOnce(0)

    await getCampaigns({ organizationId: 'org-abc' })

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-abc' } }),
    )
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-abc' }),
      }),
    )
    expect(mockReplyCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-abc' }),
      }),
    )
  })

  it('returns empty array when no campaigns exist without calling groupBy or replyCount', async () => {
    mockFindMany.mockResolvedValue([])

    const { campaigns, total } = await getCampaigns({ organizationId: 'org-empty' })

    expect(campaigns).toEqual([])
    expect(total).toBe(0)
    expect(mockGroupBy).not.toHaveBeenCalled()
    expect(mockReplyCount).not.toHaveBeenCalled()
  })

  it('defaults missing draft counts and reply count to 0', async () => {
    mockFindMany.mockResolvedValue([
      makeCampaignRow({ id: 'c1', _count: { outboundMessages: 5, drafts: 0 } }),
    ])
    mockGroupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mockReplyCount.mockResolvedValueOnce(0)

    const { campaigns } = await getCampaigns({ organizationId: 'org-1' })

    expect(campaigns[0]?.draftPendingCount).toBe(0)
    expect(campaigns[0]?.draftApprovedCount).toBe(0)
    expect(campaigns[0]?.replyCount).toBe(0)
  })

  it('issues one replyCount query per campaign', async () => {
    mockFindMany.mockResolvedValue([
      makeCampaignRow({ id: 'c1' }),
      makeCampaignRow({ id: 'c2' }),
    ])
    mockGroupBy.mockResolvedValue([])
    mockReplyCount.mockResolvedValue(0)

    await getCampaigns({ organizationId: 'org-1' })

    expect(mockReplyCount).toHaveBeenCalledTimes(2)
  })
})
