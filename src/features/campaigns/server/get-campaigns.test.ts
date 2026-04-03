import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    draft:    { groupBy: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getCampaigns } from './get-campaigns'

const mockFindMany = prisma.campaign.findMany as ReturnType<typeof vi.fn>
const mockGroupBy  = prisma.draft.groupBy  as ReturnType<typeof vi.fn>

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
  it('returns campaigns with correct aggregated counts', async () => {
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

    const { campaigns, total } = await getCampaigns({ organizationId: 'org-1' })

    expect(total).toBe(1)
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0]).toMatchObject({
      id:                'c1',
      name:              'Q2 Blitz',
      status:            'ACTIVE',
      messageCount:      12,
      draftPendingCount: 3,
      draftApprovedCount: 1,
    })
  })

  it('scopes queries to the provided organizationId', async () => {
    mockFindMany.mockResolvedValue([
      makeCampaignRow({ id: 'c1' }),
    ])
    mockGroupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await getCampaigns({ organizationId: 'org-abc' })

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-abc' } }),
    )
    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-abc' }),
      }),
    )
  })

  it('returns empty array when no campaigns exist', async () => {
    mockFindMany.mockResolvedValue([])

    const { campaigns, total } = await getCampaigns({ organizationId: 'org-empty' })

    expect(campaigns).toEqual([])
    expect(total).toBe(0)
    // groupBy should not be called when there are no campaign ids
    expect(mockGroupBy).not.toHaveBeenCalled()
  })

  it('defaults missing draft counts to 0 when groupBy returns no row for a campaign', async () => {
    mockFindMany.mockResolvedValue([
      makeCampaignRow({ id: 'c1', _count: { outboundMessages: 5, drafts: 0 } }),
    ])
    // groupBy returns empty — no drafts of any status
    mockGroupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const { campaigns } = await getCampaigns({ organizationId: 'org-1' })

    expect(campaigns[0]?.draftPendingCount).toBe(0)
    expect(campaigns[0]?.draftApprovedCount).toBe(0)
  })
})
